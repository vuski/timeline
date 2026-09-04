import { describe, expect, it } from "vitest";
import { budgetLimit, countVerts, grade, simplify, suggestFactor } from "../data/budget";
import type { Track } from "../types";

function mkTrack(id: string, n: number, kind: Track["kind"], start = "2015-06-01T10:00:00.000+09:00"): Track {
  const path = new Float64Array(n * 2);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    path[i * 2] = 127 + i * 0.001;
    path[i * 2 + 1] = 37 + i * 0.001;
    times[i] = Date.parse(start) + i * 60000;
  }
  return { id, path, times, startMs: times[0], endMs: times[n - 1], start, kind };
}

describe("countVerts", () => {
  const tracks = [mkTrack("t0", 10, "path"), mkTrack("t1", 4, "activity")];

  it("구간 안의 모든 궤적 정점을 센다", () => {
    expect(countVerts(tracks, null, 1)).toBe(14);
  });

  it("기간 밖 궤적은 세지 않는다", () => {
    const r = { from: "2020-01-01T00:00", to: "2020-12-31T23:59" };
    expect(countVerts(tracks, r, 1)).toBe(0);
  });

  it("솎기 배율을 반영한다", () => {
    // 10 정점을 2배로 솎으면 5 (양끝 보존)
    expect(countVerts([mkTrack("t0", 10, "path")], null, 2)).toBe(5);
  });

  it("빈 목록은 0", () => {
    expect(countVerts([], null, 1)).toBe(0);
  });
});

describe("grade", () => {
  it("한계의 절반 미만은 가벼움", () => {
    expect(grade(50_000, 200_000)).toBe("light");
  });

  it("절반 이상 한계 미만은 보통", () => {
    expect(grade(150_000, 200_000)).toBe("medium");
  });

  it("한계 이상은 무거움", () => {
    expect(grade(200_000, 200_000)).toBe("heavy");
    expect(grade(700_000, 200_000)).toBe("heavy");
  });
});

describe("budgetLimit", () => {
  it("모바일은 20만, 데스크톱은 60만", () => {
    expect(budgetLimit(true)).toBe(200_000);
    expect(budgetLimit(false)).toBe(600_000);
  });

  it("실측 전체(209,537)는 데스크톱에서 가볍고 모바일에서 무겁다", () => {
    expect(grade(209_537, budgetLimit(false))).toBe("light");
    expect(grade(209_537, budgetLimit(true))).toBe("heavy");
  });
});

describe("simplify", () => {
  const t = mkTrack("t0", 10, "path");

  it("배율 1 은 원본을 그대로 (참조까지 동일)", () => {
    expect(simplify(t, 1)).toBe(t);
  });

  it("배율 2 는 절반으로 줄인다", () => {
    expect(simplify(t, 2).path).toHaveLength(10); // 5 정점 × 2
  });

  it("양 끝점은 항상 보존한다 (궤적의 시작과 끝이 잘리면 안 된다)", () => {
    const s = simplify(t, 3);
    expect(s.path[0]).toBe(t.path[0]);
    expect(s.path[1]).toBe(t.path[1]);
    expect(s.path.at(-2)).toBe(t.path.at(-2));
    expect(s.path.at(-1)).toBe(t.path.at(-1));
  });

  it("시각도 좌표와 같이 솎아 길이가 맞는다", () => {
    const s = simplify(t, 3);
    expect(s.times.length).toBe(s.path.length / 2);
  });

  it("두 점짜리는 아무리 솎아도 두 점을 유지한다 (선이 사라지면 안 된다)", () => {
    const a = mkTrack("t1", 2, "activity");
    expect(simplify(a, 10).path).toHaveLength(4);
  });

  it("id·kind 를 유지한다", () => {
    const s = simplify(t, 2);
    expect(s.id).toBe("t0");
    expect(s.kind).toBe("path");
  });
});

describe("suggestFactor", () => {
  it("한계 안이면 1 (솎을 이유가 없다)", () => {
    expect(suggestFactor(100_000, 200_000)).toBe(1);
  });

  it("한계를 넘으면 한계 안으로 들어가는 최소 배율", () => {
    expect(suggestFactor(400_000, 200_000)).toBe(2);
    expect(suggestFactor(209_537, 200_000)).toBe(2);
  });
});
