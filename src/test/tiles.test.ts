import { describe, expect, it } from "vitest";
import {
  aggregateStays, displayZoom, formatStayLong, latToTileY, lngToTileX, logScale,
  stayShare, tilePolygon, tileXToLng, tileYToLat,
} from "../data/tiles";
import type { Visit } from "../types";

const U = { hour: "시간", day: "일", month: "개월", year: "년" };

const visit = (id: string, lat: number, lng: number, start: string, end: string): Visit => ({
  id, lat, lng, start, end,
  startMs: Date.parse(start),
  placeId: null,
  semanticType: null,
});

describe("타일 좌표", () => {
  // 웹 메르카토르의 정의 — 경도 0, 위도 0 은 줌 1에서 정확히 한가운데
  it("본초자오선·적도는 격자 한가운데", () => {
    expect(lngToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 10);
  });

  it("줌이 오르면 칸이 네 배로 잘게 쪼개진다", () => {
    expect(lngToTileX(180, 3)).toBe(8);
    expect(lngToTileX(180, 4)).toBe(16);
  });

  it("역변환하면 제자리로 돌아온다", () => {
    const z = 12;
    const lng = 127.0276;
    const lat = 37.4979;
    expect(tileXToLng(lngToTileX(lng, z), z)).toBeCloseTo(lng, 9);
    expect(tileYToLat(latToTileY(lat, z), z)).toBeCloseTo(lat, 9);
  });

  // 메르카토르는 극지방을 무한대로 늘린다 — 자르지 않으면 NaN/Infinity 가 나온다
  it("극지방에서도 유한한 값이 나온다", () => {
    expect(Number.isFinite(latToTileY(90, 10))).toBe(true);
    expect(Number.isFinite(latToTileY(-90, 10))).toBe(true);
  });

  it("칸의 네 모서리를 준다", () => {
    const p = tilePolygon(0, 0, 1);
    expect(p).toHaveLength(4);
    // 줌 1의 첫 칸은 서반구 북쪽 — 서쪽 끝이 -180
    expect(p[0][0]).toBeCloseTo(-180, 9);
    expect(p[2][0]).toBeCloseTo(0, 9);
  });
});

describe("aggregateStays", () => {
  it("같은 칸의 체류 시간을 더한다", () => {
    const out = aggregateStays(
      [
        visit("a", 37.5, 127.0, "2015-06-01T00:00:00Z", "2015-06-01T02:00:00Z"),
        visit("b", 37.5001, 127.0001, "2015-06-02T00:00:00Z", "2015-06-02T03:00:00Z"),
      ],
      12,
    );
    expect(out).toHaveLength(1);
    expect(out[0].minutes).toBe(300);
    expect(out[0].count).toBe(2);
  });

  it("먼 곳은 다른 칸으로 나뉜다", () => {
    const out = aggregateStays(
      [
        visit("a", 37.5, 127.0, "2015-06-01T00:00:00Z", "2015-06-01T02:00:00Z"),
        visit("b", 35.1, 129.0, "2015-06-02T00:00:00Z", "2015-06-02T02:00:00Z"),
      ],
      12,
    );
    expect(out).toHaveLength(2);
  });

  // 시각이 깨진 데이터가 총합을 오염시키면 안 된다
  it("끝이 시작보다 이른 점은 버린다", () => {
    const out = aggregateStays(
      [visit("a", 37.5, 127.0, "2015-06-01T05:00:00Z", "2015-06-01T02:00:00Z")],
      12,
    );
    expect(out).toHaveLength(0);
  });

  it("빈 입력은 빈 결과", () => {
    expect(aggregateStays([], 12)).toEqual([]);
  });

  it("칸마다 라벨 자리와 경계를 함께 준다", () => {
    const [cell] = aggregateStays(
      [visit("a", 37.5, 127.0, "2015-06-01T00:00:00Z", "2015-06-01T02:00:00Z")],
      12,
    );
    expect(cell.polygon).toHaveLength(4);
    // 한가운데는 경계 안에 있어야 한다
    const lngs = cell.polygon.map((p) => p[0]);
    expect(cell.center[0]).toBeGreaterThan(Math.min(...lngs));
    expect(cell.center[0]).toBeLessThan(Math.max(...lngs));
  });
});

describe("formatStayLong", () => {
  it("72시간 미만은 시간으로", () => {
    expect(formatStayLong(60, U)).toBe("1시간");
    expect(formatStayLong(71 * 60, U)).toBe("71시간");
  });

  it("72시간부터는 일로", () => {
    expect(formatStayLong(72 * 60, U)).toBe("3일");
    expect(formatStayLong(30 * 24 * 60, U)).toBe("30일");
  });

  it("한 달(30일)이 넘으면 개월로", () => {
    expect(formatStayLong(60 * 24 * 60, U)).toBe("2개월");
    expect(formatStayLong(90 * 24 * 60, U)).toBe("3개월");
  });

  it("365일이 넘으면 년·개월로", () => {
    expect(formatStayLong(400 * 24 * 60, U)).toBe("1년 1개월");
    expect(formatStayLong(365 * 24 * 60 * 2, U)).toBe("2년");
  });

  // "1년 12개월" 같은 표기가 나오면 안 된다
  it("반올림이 열두 달을 채우면 해를 올린다", () => {
    const out = formatStayLong(724 * 24 * 60, U);
    expect(out).not.toMatch(/12개월/);
    expect(out).toBe("2년");
  });
});

describe("displayZoom", () => {
  // 지도 줌보다 세 단계 잘게 — 동네 단위로 구분된다
  it("지도 줌 + 3 으로 잡는다", () => {
    expect(displayZoom(8)).toBe(11);
    expect(displayZoom(8.9)).toBe(11);
  });

  it("너무 성기거나 잘게 쪼개지지 않게 묶는다", () => {
    expect(displayZoom(0)).toBe(3);
    expect(displayZoom(20)).toBe(15);
  });
});

describe("stayShare", () => {
  it("소수점 첫째 자리까지 적는다", () => {
    expect(stayShare(1234, 10000)).toBe("12.3%");
  });

  // 둘째 자리에서 반올림
  it("둘째 자리에서 반올림한다", () => {
    expect(stayShare(1236, 10000)).toBe("12.4%");
    expect(stayShare(1234, 10000)).toBe("12.3%");
  });

  it("혼자면 100%", () => {
    expect(stayShare(500, 500)).toBe("100.0%");
  });

  // 집계가 비었을 때 "NaN%" 이나 "Infinity%" 가 칸에 찍히면 안 된다
  it("총합이 0이면 빈 문자열", () => {
    expect(stayShare(0, 0)).toBe("");
  });
});

describe("logScale", () => {
  it("양 끝은 0 과 1", () => {
    expect(logScale(1, 1, 1000)).toBe(0);
    expect(logScale(1000, 1, 1000)).toBe(1);
  });

  /*
   * 로그의 요점 — 가운데가 산술 평균이 아니라 기하 평균이다.
   * 1 과 10000 의 한가운데는 5000 이 아니라 100 이다.
   */
  it("자릿수 기준으로 가운데를 잡는다", () => {
    expect(logScale(100, 1, 10000)).toBeCloseTo(0.5, 5);
  });

  it("범위를 벗어나도 0~1 안에 머문다", () => {
    expect(logScale(99999, 1, 1000)).toBe(1);
    expect(logScale(0, 10, 1000)).toBe(0);
  });

  // 0 이 들어오면 log 가 -무한대로 간다 — 밑을 1분으로 받친다
  it("0 이어도 유한한 값", () => {
    expect(Number.isFinite(logScale(0, 0, 1000))).toBe(true);
  });

  it("모두 같은 값이면 1", () => {
    expect(logScale(50, 50, 50)).toBe(1);
  });

  // 압도적인 한 칸이 있어도 아래쪽이 뭉개지지 않아야 한다
  it("자릿수가 크게 벌어져도 아래쪽이 구분된다", () => {
    const lo = 60;
    const hi = 60 * 24 * 2589;
    const a = logScale(60 * 5, lo, hi);
    const b = logScale(60 * 50, lo, hi);
    expect(b - a).toBeGreaterThan(0.1);
  });
});
