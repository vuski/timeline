import { describe, expect, it } from "vitest";
import {
  ARC_BEND, ARC_SEGMENTS, arcPath, anchoredTracks, arcTracks, linkNodes,
} from "../data/connect";
import type { Track, Visit } from "../types";

const iso = (h: number) => `2015-06-01T${String(h).padStart(2, "0")}:00:00.000+09:00`;

const visit = (id: string, startH: number, endH: number, lat = 37, lng = 127): Visit => ({
  id, lat, lng,
  start: iso(startH),
  end: iso(endH),
  startMs: Date.parse(iso(startH)),
  placeId: null, semanticType: null,
});

const track = (id: string, startH: number, endH: number, pts?: [number, number][]): Track => {
  const p = pts ?? [[127, 37], [127.1, 37.1]];
  return {
    id,
    path: Float64Array.from(p.flatMap(([lng, lat]) => [lng, lat])),
    times: Float64Array.from(p.map((_, i) => Date.parse(iso(startH + i)))),
    startMs: Date.parse(iso(startH)),
    endMs: Date.parse(iso(endH)),
    start: iso(startH),
    kind: "path",
  };
};

describe("arcPath", () => {
  it("정점 수는 조각 수 + 1", () => {
    expect(arcPath([0, 0], [10, 0]).length / 2).toBe(ARC_SEGMENTS + 1);
  });

  it("양 끝점은 정확히 출발·도착이다", () => {
    const p = arcPath([1, 2], [5, 6]);
    expect([p[0], p[1]]).toEqual([1, 2]);
    expect([p.at(-2), p.at(-1)]).toEqual([5, 6]);
  });

  it("중앙이 직선에서 벗어난다 (호가 된다)", () => {
    const p = arcPath([0, 0], [10, 0]);
    const midY = p[ARC_SEGMENTS + 1]; // 중앙 정점의 y
    expect(Math.abs(midY)).toBeGreaterThan(0);
  });

  it("모든 호가 같은 곡률 — 길이에 비례해 휜다", () => {
    const short = arcPath([0, 0], [10, 0]);
    const long = arcPath([0, 0], [20, 0]);
    const bendOf = (p: number[], len: number) =>
      Math.abs(p[ARC_SEGMENTS + 1]) / len;
    expect(bendOf(short, 10)).toBeCloseTo(bendOf(long, 20), 10);
  });

  it("곡률 0 이면 직선", () => {
    const p = arcPath([0, 0], [10, 0], 4, 0);
    expect(p[3]).toBeCloseTo(0, 10);
  });

  it("기본 곡률은 원본 프로젝트와 같은 0.1", () => {
    expect(ARC_BEND).toBe(0.1);
  });
});

describe("arcTracks (이동구간 모드)", () => {
  it("점이 2개 미만이면 선이 없다", () => {
    expect(arcTracks([])).toEqual([]);
    expect(arcTracks([visit("v1", 9, 10)])).toEqual([]);
  });

  it("점 N 개면 호 N-1 개", () => {
    const vs = [visit("v1", 9, 10), visit("v2", 11, 12), visit("v3", 13, 14)];
    expect(arcTracks(vs)).toHaveLength(2);
  });

  it("호의 시각은 앞 점이 떠난 때부터 뒤 점에 닿은 때까지", () => {
    const vs = [visit("v1", 9, 10), visit("v2", 11, 12)];
    const [arc] = arcTracks(vs);
    expect(arc.startMs).toBe(Date.parse(iso(10)));
    expect(arc.endMs).toBe(Date.parse(iso(11)));
  });

  it("시각이 정점마다 고르게 퍼진다 (재생이 매끄럽도록)", () => {
    const [arc] = arcTracks([visit("v1", 9, 10), visit("v2", 11, 12)]);
    expect(arc.times.length).toBe(arc.path.length / 2);
    expect(arc.times[0]).toBe(arc.startMs);
    expect(arc.times.at(-1)).toBe(arc.endMs);
    // 단조 증가
    for (let i = 1; i < arc.times.length; i++) {
      expect(arc.times[i]).toBeGreaterThan(arc.times[i - 1]);
    }
  });

  it("시간순으로 잇는다 (입력 순서가 뒤섞여도)", () => {
    const vs = [visit("late", 13, 14), visit("early", 9, 10)];
    const [arc] = arcTracks(vs);
    expect(arc.id).toBe("arc-early-late");
  });
});

describe("linkNodes — 조각과 체류점을 시간순으로 잇는다", () => {
  it("이을 것이 하나뿐이면 선이 없다", () => {
    expect(linkNodes([track("t0", 9, 10)], [])).toEqual([]);
    expect(linkNodes([], [visit("v0", 9, 10)])).toEqual([]);
  });

  it("조각과 조각 사이를 호로 잇는다 — 직선이 아니다", () => {
    const a = track("a", 9, 10, [[1, 1], [2, 2]]);
    const b = track("b", 13, 14, [[5, 5], [6, 6]]);
    const [link] = linkNodes([a, b], []);
    // 직선이면 정점 2개. 호라서 조각 수 + 1 이다.
    expect(link.path.length / 2).toBe(ARC_SEGMENTS + 1);
    expect([link.path[0], link.path[1]]).toEqual([2, 2]);
    expect([link.path.at(-2), link.path.at(-1)]).toEqual([5, 5]);
  });

  it("체류점이 사이에 있으면 조각→체류→조각 순으로 잇는다", () => {
    const a = track("a", 9, 10, [[1, 1], [2, 2]]);
    const v = visit("v", 11, 12, 3, 3);
    const b = track("b", 13, 14, [[5, 5], [6, 6]]);
    const links = linkNodes([a, b], [v]);
    expect(links).toHaveLength(2);
    // 첫 선: 조각A 끝(2,2) → 체류(3,3)
    expect([links[0].path[0], links[0].path[1]]).toEqual([2, 2]);
    expect([links[0].path.at(-2), links[0].path.at(-1)]).toEqual([3, 3]);
    // 둘째 선: 체류(3,3) → 조각B 시작(5,5)
    expect([links[1].path[0], links[1].path[1]]).toEqual([3, 3]);
    expect([links[1].path.at(-2), links[1].path.at(-1)]).toEqual([5, 5]);
  });

  it("체류점끼리도 호로 잇는다", () => {
    const links = linkNodes([], [visit("v0", 9, 10, 1, 1), visit("v1", 11, 12, 2, 2)]);
    expect(links).toHaveLength(1);
    expect(links[0].path.length / 2).toBe(ARC_SEGMENTS + 1);
  });

  it("시각 순으로 늘어놓는다 — 입력 순서가 뒤죽박죽이어도", () => {
    const late = track("late", 13, 14, [[5, 5], [6, 6]]);
    const early = track("early", 9, 10, [[1, 1], [2, 2]]);
    const [link] = linkNodes([late, early], []);
    // early 끝(2,2) 에서 시작해야 한다 — 입력 순서를 따랐다면 (6,6) 이다
    expect([link.path[0], link.path[1]]).toEqual([2, 2]);
  });

  it("같은 자리면 선을 만들지 않는다", () => {
    const a = track("a", 9, 10, [[1, 1], [2, 2]]);
    const v = visit("v", 11, 12, 2, 2); // 조각 A 의 끝점과 같은 좌표
    expect(linkNodes([a], [v])).toEqual([]);
  });

  it("이은 선은 activity 로 표시한다 (실측 경로가 아니다)", () => {
    const [link] = linkNodes([track("t0", 9, 10), track("t1", 13, 14)], []);
    expect(link.kind).toBe("activity");
  });

  it("이은 선의 시간은 앞의 끝 ~ 뒤의 시작이다", () => {
    const a = track("a", 9, 10);
    const b = track("b", 13, 14);
    const [link] = linkNodes([a, b], []);
    expect(link.startMs).toBe(a.endMs);
    expect(link.endMs).toBe(b.startMs);
  });
});

describe("anchoredTracks - 앞뒤 점이 모두 살아 있는 조각만 남는다", () => {
  const all = [visit("v0", 9, 10), visit("v1", 13, 14), visit("v2", 17, 18)];
  const ts = [track("a", 11, 12), track("b", 15, 16)];

  it("점을 지우면 그 점으로 드나든 조각이 함께 빠진다", () => {
    expect(anchoredTracks(all, new Set(["v0", "v1", "v2"]), ts).map((t) => t.id)).toEqual(["a", "b"]);
    // 가운데 점을 지우면 a(→v1) 와 b(v1→) 둘 다
    expect(anchoredTracks(all, new Set(["v0", "v2"]), ts)).toEqual([]);
  });

  it("한쪽 끝 점만 지워도 그 조각은 빠진다 - 서울만 남기면 서울↔인천은 사라진다", () => {
    expect(anchoredTracks(all, new Set(["v1", "v2"]), ts).map((t) => t.id)).toEqual(["b"]);
  });
});
