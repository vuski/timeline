import { describe, expect, it } from "vitest";
import {
  applySelection, boundsOf, invertSelection, tracksIn, visitsIn,
} from "../data/select";
import type { Track, Visit } from "../types";

const v = (id: string, lat: number, lng: number): Visit => ({
  id, lat, lng, start: "2015-06-01T10:00:00.000+09:00",
  end: "2015-06-01T11:00:00.000+09:00", startMs: 0, placeId: null, semanticType: null,
});

const track = (id: string, pts: [number, number][]): Track => ({
  id,
  path: Float64Array.from(pts.flatMap(([lng, lat]) => [lng, lat])),
  times: Float64Array.from(pts.map((_, i) => i * 1000)),
  startMs: 0, endMs: pts.length * 1000,
  start: "2015-06-01T10:00:00.000+09:00", kind: "path",
});

describe("boundsOf", () => {
  it("드래그 방향과 무관하게 같은 사각형을 만든다", () => {
    const a = boundsOf({ lat: 37, lng: 127 }, { lat: 38, lng: 128 });
    const b = boundsOf({ lat: 38, lng: 128 }, { lat: 37, lng: 127 });
    expect(a).toEqual(b);
    expect(a).toEqual({ minLat: 37, maxLat: 38, minLng: 127, maxLng: 128 });
  });
});

describe("visitsIn", () => {
  const visits = [v("v0", 37.5, 127.5), v("v1", 39, 127.5), v("v2", 37.5, 129)];
  const b = { minLat: 37, maxLat: 38, minLng: 127, maxLng: 128 };

  it("사각형 안의 점만 고른다", () => {
    expect(visitsIn(visits, b)).toEqual(["v0"]);
  });

  it("경계 위의 점을 포함한다", () => {
    expect(visitsIn([v("e", 37, 127)], b)).toEqual(["e"]);
  });
});

describe("tracksIn", () => {
  const b = { minLat: 37, maxLat: 38, minLng: 127, maxLng: 128 };

  it("정점이 하나라도 들어오면 선택한다", () => {
    const t = track("t0", [[120, 30], [127.5, 37.5], [130, 40]]);
    expect(tracksIn([t], b)).toEqual(["t0"]);
  });

  it("모든 정점이 밖이면 선택하지 않는다", () => {
    const t = track("t1", [[120, 30], [130, 40]]);
    expect(tracksIn([t], b)).toEqual([]);
  });
});

describe("applySelection", () => {
  const prev = new Set(["a", "b"]);

  it("replace 는 새 선택으로 갈아치운다", () => {
    expect([...applySelection(prev, ["c"], "replace")]).toEqual(["c"]);
  });

  it("add 는 합집합", () => {
    expect([...applySelection(prev, ["c"], "add")].sort()).toEqual(["a", "b", "c"]);
  });

  it("subtract 는 차집합", () => {
    expect([...applySelection(prev, ["b"], "subtract")]).toEqual(["a"]);
  });

  it("원본 집합을 수정하지 않는다", () => {
    applySelection(prev, ["c"], "add");
    expect([...prev].sort()).toEqual(["a", "b"]);
  });
});

describe("invertSelection", () => {
  it("선택과 비선택을 맞바꾼다", () => {
    const out = invertSelection(new Set(["a"]), ["a", "b", "c"]);
    expect([...out].sort()).toEqual(["b", "c"]);
  });
});
