import { describe, expect, it } from "vitest";
import { gapsForRemovedVisits, tracksLinkedTo } from "../data/linked";
import type { Track, Visit } from "../types";

/** 시각을 시(hour)로만 주는 짧은 헬퍼 — 2015-06-01 하루를 쓴다 */
const iso = (h: number, m = 0) =>
  `2015-06-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000+09:00`;

const visit = (id: string, startH: number, endH: number): Visit => ({
  id,
  lat: 37,
  lng: 127,
  start: iso(startH),
  end: iso(endH),
  startMs: Date.parse(iso(startH)),
  placeId: null,
  semanticType: null,
});

const track = (id: string, startH: number, endH: number): Track => ({
  id,
  path: Float64Array.from([127, 37, 127.1, 37.1]),
  times: Float64Array.from([Date.parse(iso(startH)), Date.parse(iso(endH))]),
  startMs: Date.parse(iso(startH)),
  endMs: Date.parse(iso(endH)),
  start: iso(startH),
  kind: "path",
});

/**
 * 점1(09~10) ─A(10~11)─ 점2(11~12) ─B(12~13)─ 점3(13~14) ─C(14~15)─ 점4(15~16)
 */
const visits = [visit("v1", 9, 10), visit("v2", 11, 12), visit("v3", 13, 14), visit("v4", 15, 16)];
const tracks = [track("A", 10, 11), track("B", 12, 13), track("C", 14, 15)];

describe("gapsForRemovedVisits", () => {
  it("지울 점이 없으면 구간도 없다", () => {
    expect(gapsForRemovedVisits(new Set(), visits)).toEqual([]);
  });

  it("가운데 점 하나 — 앞 점 끝부터 뒤 점 시작까지", () => {
    // v2 를 지우면 v1 끝(10시) ~ v3 시작(13시)
    expect(gapsForRemovedVisits(new Set(["v2"]), visits)).toEqual([
      [Date.parse(iso(10)), Date.parse(iso(13))],
    ]);
  });

  it("연속한 점 여러 개는 하나의 구간으로 합친다", () => {
    // v2,v3 을 지우면 v1 끝(10시) ~ v4 시작(15시)
    expect(gapsForRemovedVisits(new Set(["v2", "v3"]), visits)).toEqual([
      [Date.parse(iso(10)), Date.parse(iso(15))],
    ]);
  });

  it("떨어진 점들은 각각의 구간이 된다", () => {
    const gaps = gapsForRemovedVisits(new Set(["v2", "v4"]), visits);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual([Date.parse(iso(10)), Date.parse(iso(13))]);
    // v4 는 마지막이라 뒤가 열려 있다
    expect(gaps[1][0]).toBe(Date.parse(iso(14)));
    expect(gaps[1][1]).toBe(Infinity);
  });

  it("첫 점을 지우면 앞쪽이 열린다", () => {
    const gaps = gapsForRemovedVisits(new Set(["v1"]), visits);
    expect(gaps[0][0]).toBe(-Infinity);
    expect(gaps[0][1]).toBe(Date.parse(iso(11)));
  });

  it("전부 지우면 시간 전체가 한 구간", () => {
    const gaps = gapsForRemovedVisits(new Set(["v1", "v2", "v3", "v4"]), visits);
    expect(gaps).toEqual([[-Infinity, Infinity]]);
  });
});

describe("tracksLinkedTo", () => {
  it("지울 점이 없으면 아무 궤적도 지우지 않는다", () => {
    expect(tracksLinkedTo(new Set(), visits, tracks)).toEqual([]);
  });

  it("가운데 점을 지우면 그 앞뒤 이동을 모두 지운다", () => {
    // v2 삭제 → 10~13시 → A(10~11) 와 B(12~13) 둘 다
    expect(tracksLinkedTo(new Set(["v2"]), visits, tracks).sort()).toEqual(["A", "B"]);
  });

  it("무관한 이동은 남긴다", () => {
    // C(14~15)는 v3~v4 사이라 v2 삭제와 무관
    expect(tracksLinkedTo(new Set(["v2"]), visits, tracks)).not.toContain("C");
  });

  it("연속한 점을 지우면 그 사이 이동이 전부 사라진다", () => {
    // v2,v3 삭제 → 10~15시 → A, B, C 전부
    expect(tracksLinkedTo(new Set(["v2", "v3"]), visits, tracks).sort()).toEqual(["A", "B", "C"]);
  });

  it("마지막 점을 지우면 그 앞 이동을 지운다", () => {
    // v4 삭제 → 14시~∞ → C(14~15)
    expect(tracksLinkedTo(new Set(["v4"]), visits, tracks)).toEqual(["C"]);
  });

  it("첫 점을 지우면 그 뒤 이동을 지운다", () => {
    // v1 삭제 → -∞~11시 → A(10~11)
    expect(tracksLinkedTo(new Set(["v1"]), visits, tracks)).toEqual(["A"]);
  });

  it("구간에 걸치기만 해도 지운다 (일부만 겹쳐도 의미가 깨진다)", () => {
    const straddling = [track("X", 12, 20)]; // v2 구간(10~13)에 걸친다
    expect(tracksLinkedTo(new Set(["v2"]), visits, straddling)).toEqual(["X"]);
  });

  it("좌표와 무관하게 시간으로만 판정한다", () => {
    // 좌표가 전혀 다른 궤적도 시간이 구간 안이면 지운다 —
    // 체류점 좌표와 궤적 끝점이 정확히 일치하는 건 31% 뿐이다
    const faraway: Track[] = [{ ...track("F", 10, 11), path: Float64Array.from([0, 0, 1, 1]) }];
    expect(tracksLinkedTo(new Set(["v2"]), visits, faraway)).toEqual(["F"]);
  });

  it("점이 하나뿐이고 그것을 지우면 모든 궤적이 사라진다", () => {
    const one = [visit("only", 9, 10)];
    expect(tracksLinkedTo(new Set(["only"]), one, tracks).sort()).toEqual(["A", "B", "C"]);
  });
});
