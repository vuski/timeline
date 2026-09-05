import { describe, expect, it } from "vitest";
import {
  aggregateStays, displayZoom, formatShareExact, formatSpan, formatStayFull, formatStayLong,
  histogramSvg, HIST_BINS, HIST_W, latToTileY, lngToTileX, logScale, stayShare,
  summarize, tilePolygon, tileXToLng, tileYToLat,
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

describe("summarize", () => {
  const v = (start: string, end: string) => visit("x", 37, 127, start, end);
  /* 이동 구간 — activity 세그먼트의 시각만 */
  const mv = (start: string, end: string): [number, number] => [
    Date.parse(start),
    Date.parse(end),
  ];

  it("기간은 첫 기록부터 마지막 기록까지로 잡는다", () => {
    const s = summarize([
      v("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z"),
      v("2020-01-10T00:00:00Z", "2020-01-11T00:00:00Z"),
    ])!;
    expect(s.totalMinutes).toBe(10 * 24 * 60);
    expect(s.stayMinutes).toBe(2 * 24 * 60);
  });

  /* 셋을 따로 반올림하면 99% 나 101% 가 나온다 */
  it("세 비율의 합은 항상 100 이다", () => {
    for (const h of [1, 7, 13, 17, 23, 29, 31, 47, 59, 71]) {
      const s = summarize([
        v("2020-01-01T00:00:00Z", `2020-01-01T${String(h % 24).padStart(2, "0")}:00:00Z`),
        v("2020-01-04T00:00:00Z", "2020-01-04T01:00:00Z"),
      ]);
      if (s) expect(s.stayPct + s.movePct + s.gapPct).toBe(100);
    }
  });

  /*
   * 이 갈래가 이 함수의 요점이다.
   *
   * 앞서는 전체에서 체류를 뺀 나머지를 통째로 이동이라 불렀는데, 실측
   * 파일에서 그 나머지 580일 중 91일은 이동이 아니라 아무 기록도 없는
   * 시간이었다. 기록이 없는 것을 "이동했다" 고 말하면 사실이 아니다.
   */
  it("이동과 기록 없음을 갈라 센다", () => {
    const day = (n: number) => `2020-01-${String(n).padStart(2, "0")}T00:00:00Z`;
    const s = summarize(
      // 1일 하루 체류
      [v(day(1), day(2))],
      // 2~3일 이동, 3~5일은 아무 기록 없음
      [mv(day(2), day(3))],
    )!;

    expect(s.stayMinutes).toBe(24 * 60);
    expect(s.moveMinutes).toBe(24 * 60);
    // 5일까지 늘리려면 마지막 기록이 있어야 하므로 여기서는 공백 0
    expect(s.gapMinutes).toBe(0);
  });

  it("체류와 이동 사이의 빈 시간을 공백으로 센다", () => {
    const day = (n: number) => `2020-01-${String(n).padStart(2, "0")}T00:00:00Z`;
    const s = summarize(
      [v(day(1), day(2)), v(day(9), day(10))],
      [mv(day(2), day(3))],
    )!;
    // 전체 9일: 체류 2일, 이동 1일, 나머지 6일이 공백
    expect(s.stayMinutes).toBe(2 * 24 * 60);
    expect(s.moveMinutes).toBe(24 * 60);
    expect(s.gapMinutes).toBe(6 * 24 * 60);
  });

  /*
   * 구글은 같은 시간에 체류와 이동을 함께 기록하기도 한다. 그대로 더하면
   * 합이 100% 를 넘는다.
   */
  it("체류와 이동이 겹치면 체류로 센다", () => {
    const s = summarize(
      [v("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z")],
      [mv("2020-01-01T06:00:00Z", "2020-01-01T12:00:00Z")],
    )!;
    expect(s.stayMinutes).toBe(24 * 60);
    expect(s.moveMinutes).toBe(0);
    expect(s.stayPct + s.movePct + s.gapPct).toBe(100);
  });

  it("궤적이 없으면 나머지는 모두 공백이다", () => {
    const s = summarize([
      v("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z"),
      v("2020-01-05T00:00:00Z", "2020-01-06T00:00:00Z"),
    ])!;
    expect(s.moveMinutes).toBe(0);
    expect(s.gapMinutes).toBe(3 * 24 * 60);
  });

  /*
   * 실측 파일에 겹치는 방문이 1,035쌍 있었다 — 막지 않으면 "체류 103%".
   */
  it("겹치는 방문이 있어도 체류가 기간을 넘지 않는다", () => {
    const s = summarize([
      v("2020-01-01T00:00:00Z", "2020-01-03T00:00:00Z"),
      v("2020-01-01T00:00:00Z", "2020-01-03T00:00:00Z"),
    ])!;
    expect(s.stayMinutes).toBeLessThanOrEqual(s.totalMinutes);
    expect(s.stayPct).toBeLessThanOrEqual(100);
    expect(s.movePct).toBeGreaterThanOrEqual(0);
  });

  /*
   * 사용자가 기간을 아무렇게나 좁혀도 셈이 맞아야 한다.
   *
   * 이동 구간은 원본이라 기간 필터를 거치지 않으므로, 창을 함께 주지
   * 않으면 창 밖의 이동까지 세어 비율이 100% 를 넘는다.
   */
  describe("기간을 좁혔을 때", () => {
    const day = (n: number) => `2020-01-${String(n).padStart(2, "0")}T00:00:00Z`;
    const win = (a: number, b: number) => ({
      startMs: Date.parse(day(a)),
      endMs: Date.parse(day(b)),
    });

    it("창에 걸친 체류를 잘라서 센다", () => {
      // 1~9일 체류인데 창은 3~5일 — 이틀만 세야 한다
      const s = summarize([v(day(1), day(9))], [], win(3, 5))!;
      expect(s.totalMinutes).toBe(2 * 24 * 60);
      expect(s.stayMinutes).toBe(2 * 24 * 60);
      expect(s.stayPct).toBe(100);
    });

    it("창에 걸친 이동도 잘라서 센다", () => {
      const s = summarize([], [mv(day(1), day(9))], win(3, 5))!;
      expect(s.moveMinutes).toBe(2 * 24 * 60);
      expect(s.movePct).toBe(100);
    });

    it("창 밖의 기록은 세지 않는다", () => {
      const s = summarize(
        [v(day(1), day(2)), v(day(20), day(21))],
        [mv(day(25), day(26))],
        win(10, 12),
      )!;
      expect(s.stayMinutes).toBe(0);
      expect(s.moveMinutes).toBe(0);
      expect(s.gapPct).toBe(100);
    });

    /* 어떤 창을 줘도 세 몫의 합은 창 길이와 같아야 한다 */
    it("어떤 창을 줘도 합이 창 길이와 같다", () => {
      const visits = [v(day(1), day(3)), v(day(8), day(12))];
      const moves = [mv(day(3), day(5)), mv(day(15), day(17))];
      for (const [a, b] of [[1, 20], [2, 9], [4, 6], [11, 16], [18, 19]]) {
        const s = summarize(visits, moves, win(a, b))!;
        expect(s.stayMinutes + s.moveMinutes + s.gapMinutes).toBeCloseTo(s.totalMinutes, 6);
        expect(s.stayPct + s.movePct + s.gapPct).toBe(100);
      }
    });

    it("창을 주지 않으면 기록이 있는 범위로 잡는다", () => {
      const s = summarize([v(day(3), day(5))])!;
      expect(s.totalMinutes).toBe(2 * 24 * 60);
    });
  });

  it("쓸 수 없는 입력에는 아무것도 내놓지 않는다", () => {
    expect(summarize([])).toBeUndefined();
    expect(summarize([v("bad", "worse")])).toBeUndefined();
    // 한 점뿐이면 기간이 0 이라 비율을 만들 수 없다
    expect(summarize([v("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z")])).toBeUndefined();
  });
});

describe("formatSpan", () => {
  const u = { hour: "시간", day: "일", month: "개월", year: "년" };
  const days = (n: number) => n * 24 * 60;

  it("365일까지는 일 단위로 쓴다", () => {
    expect(formatSpan(days(1), u)).toBe("1일");
    expect(formatSpan(days(200), u)).toBe("200일");
    expect(formatSpan(days(365), u)).toBe("365일");
  });

  it("365일을 넘으면 년과 개월로 쓴다", () => {
    expect(formatSpan(days(366), u)).toBe("1년");
    expect(formatSpan(days(365 + 60), u)).toBe("1년 2개월");
    // 실측 파일 = 4494일
    expect(formatSpan(days(4494), u)).toBe("12년 4개월");
  });

  /* "1년 12개월" 은 새어나오기 쉬운 표기다 */
  it("12개월로 반올림되면 해를 올린다", () => {
    expect(formatSpan(days(365 + 359), u)).toBe("2년");
    expect(formatSpan(days(365 + 359), u)).not.toMatch(/12개월/);
  });
});

describe("툴팁", () => {
  /* 값 막대만 센다 — 축선도 rect 라 그냥 세면 하나 더 잡힌다 */
  const bars = (svg: string) =>
    (svg.match(/<rect(?![^>]*tip-hist-axis)/g) ?? []).length;

  /* 폭 101px 안에 막대 2px + 간격 1px 로 꽉 채운다 */
  it("막대와 간격이 101px 에 딱 맞는다", () => {
    expect(HIST_W).toBe(101);
    expect(HIST_BINS).toBe(34);
  });

  it("체류 시간을 년·개월·일·시간으로 모두 풀어 쓴다", () => {
    const u = { hour: "시간", day: "일", month: "개월", year: "년" };
    const h = (n: number) => n * 60;
    // 1년 365일, 1개월 30일 (사용자 지정)
    expect(formatStayFull(h(365 * 24), u)).toBe("1년");
    expect(formatStayFull(h(30 * 24), u)).toBe("1개월");
    expect(formatStayFull(h((365 + 60) * 24 + 7), u)).toBe("1년 2개월 7시간");
    expect(formatStayFull(h(3), u)).toBe("3시간");
  });

  /* "2년 0개월 14일" 은 읽기만 나쁘다 */
  it("0 인 단위는 건너뛴다", () => {
    const u = { hour: "시간", day: "일", month: "개월", year: "년" };
    expect(formatStayFull(2 * 365 * 24 * 60, u)).toBe("2년");
    expect(formatStayFull(2 * 365 * 24 * 60, u)).not.toMatch(/0개월/);
  });

  /* 시간 이하는 정수로 반올림 — 분·초를 보여줄 자리가 아니다 */
  it("시간 이하는 반올림한다", () => {
    const u = { hour: "시간", day: "일", month: "개월", year: "년" };
    expect(formatStayFull(89, u)).toBe("1시간");
    expect(formatStayFull(91, u)).toBe("2시간");
    // 모든 단위가 0 이 되어도 빈칸을 남기지 않는다
    expect(formatStayFull(0, u)).toBe("0시간");
    expect(formatStayFull(1, u)).toBe("0시간");
  });

  it("빈 히스토그램에는 막대를 그리지 않는다 (축선은 남는다)", () => {
    const svg = histogramSvg(new Array(HIST_BINS).fill(0));
    // 축선 하나만 — 값 막대는 없다
    expect(bars(svg)).toBe(0);
    expect(svg).toMatch(/tip-hist-axis/);
    expect(svg).toMatch(`width="101"`);
  });

  /* 값이 있는데 막대가 사라지면 "그때는 없었다" 로 잘못 읽힌다 */
  it("아주 작은 값도 최소 1px 막대로 남긴다", () => {
    const h = new Array(HIST_BINS).fill(0);
    h[0] = 100000;
    h[5] = 0.001;
    const svg = histogramSvg(h);
    expect(bars(svg)).toBe(2);
    expect(svg).toMatch(/height="1"/);
  });

  /* 막대가 어디서부터 올라온 것인지 바닥이 보여야 높이가 읽힌다 */
  it("바닥에 축선을 긋는다", () => {
    const svg = histogramSvg(new Array(HIST_BINS).fill(1));
    expect(svg).toMatch(/class="tip-hist-axis"[^>]*width="101"/);
  });

  it("칸마다 히스토그램을 채운다", () => {
    const tiles = aggregateStays(
      [
        visit("a", 37.5, 127.0, "2020-01-01T00:00:00Z", "2020-01-01T02:00:00Z"),
        visit("b", 37.5, 127.0, "2020-12-30T00:00:00Z", "2020-12-30T02:00:00Z"),
      ],
      12,
    );
    const [cell] = tiles;
    expect(cell.hist).toHaveLength(HIST_BINS);
    // 처음과 끝에 하나씩 — 가운데는 비어 있다
    expect(cell.hist[0]).toBeGreaterThan(0);
    expect(cell.hist[HIST_BINS - 1]).toBeGreaterThan(0);
    expect(cell.hist.reduce((a, b) => a + b, 0)).toBeCloseTo(cell.minutes, 6);
  });
});

describe("formatShareExact", () => {
  /*
   * 칸 위에는 "0.0%" 로 뭉개지는 짧은 체류가 많다. 툴팁은 원본 수치를
   * 보는 자리라 자리를 늘려 구분이 되게 한다.
   */
  it("칸 라벨보다 한 자리 더 준다", () => {
    expect(stayShare(60, 6000)).toBe("1.0%");
    expect(formatShareExact(60, 6000)).toBe("1.00000%");
  });

  it("칸에서 0.0% 로 뭉개지던 값도 구분된다", () => {
    expect(stayShare(1, 100000)).toBe("0.0%");
    expect(formatShareExact(1, 100000)).toBe("0.00100%");
  });

  it("분모가 없으면 빈 문자열", () => {
    expect(formatShareExact(60, 0)).toBe("");
  });
});
