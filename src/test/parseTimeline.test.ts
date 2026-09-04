import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTimeline } from "../data/parseTimeline";

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(resolve(here, "fixtures/sample.json"), "utf-8");

describe("parseTimeline", () => {
  const d = parseTimeline(sample);

  it("visit 을 체류점으로 만든다 (좌표 없는 것은 버린다)", () => {
    expect(d.visits).toHaveLength(1);
    expect(d.visits[0]).toMatchObject({
      id: "v0",
      lat: 37.5205264,
      lng: 126.8821109,
      start: "2014-05-09T20:34:34.000+09:00",
      placeId: "ChIJdZ9VqImefDURYex8v7mpQ00",
      semanticType: "INFERRED_HOME",
    });
  });

  it("timelinePath 를 실측 궤적으로 만든다", () => {
    const paths = d.tracks.filter((t) => t.kind === "path");
    // 2015-07-01 블록만 남는다. 2014-05-09 블록은 v0 체류(05-09~05-13)
    // 안에 통째로 들어가 잘려 나갔다 — 아래 별도 테스트 참고.
    expect(paths).toHaveLength(1);
    expect(paths[0].times).toHaveLength(2);
  });

  it("체류 시간에 든 정점은 잘라낸다", () => {
    // 2014-05-09 궤적은 v0 체류 구간에 완전히 파묻혀 있다. 머무는 동안의
    // GPS 흔들림이라 남기면 체류점 위에 실뭉치가 얹힌다.
    expect(d.tracks.some((t) => t.start.startsWith("2014-05-09"))).toBe(false);
  });

  it("좌표는 [lng, lat] 순서로 평탄하게 담긴다 (deck.gl 규약)", () => {
    const p = d.tracks.find((t) => t.kind === "path")!;
    expect(p.path[0]).toBeGreaterThan(120); // lng 이 먼저
    expect(p.path[1]).toBeLessThan(90); // lat 이 나중
  });

  it("activity 는 쓰지 않는다", () => {
    // 출발·도착 좌표 두 개뿐이라 실측 궤적이 있으면 쓸 이유가 없고,
    // 궤적이 없는 시간은 체류점을 호로 이어 메꾼다(connect.ts).
    expect(d.tracks.every((t) => t.kind === "path")).toBe(true);
  });

  it("정점이 1개뿐인 궤적은 버린다 (선을 그릴 수 없다)", () => {
    for (const t of d.tracks) expect(t.path.length).toBeGreaterThanOrEqual(4);
  });

  it("깨진 좌표·결측 세그먼트를 조용히 건너뛴다", () => {
    expect(d.tracks.every((t) => t.path.every(Number.isFinite))).toBe(true);
  });

  it("정점 수와 연도별 분포를 함께 집계한다", () => {
    const sum = d.tracks.reduce((n, t) => n + t.path.length / 2, 0);
    expect(d.totalVerts).toBe(sum);
    // 2014 궤적은 체류에 파묻혀 잘렸고, activity 는 쓰지 않는다
    expect(d.vertsByYear["2014"]).toBeUndefined();
    expect(d.vertsByYear["2015"]).toBe(2);
  });

  it("전체 기간을 YYYY-MM-DD 로 알려준다", () => {
    expect(d.spanFrom).toBe("2014-05-09");
    expect(d.spanTo).toBe("2015-07-01");
  });

  it("체류점을 시각 순으로 정렬한다", () => {
    const starts = d.visits.map((v) => v.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("궤적을 시각 순으로 정렬한다", () => {
    const ms = d.tracks.map((t) => t.startMs);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });

  it("진행률을 0에서 100까지 보고한다", () => {
    const pcts: number[] = [];
    parseTimeline(sample, (p) => pcts.push(p));
    expect(pcts.at(-1)).toBe(100);
    expect(Math.min(...pcts)).toBeGreaterThanOrEqual(0);
  });

  it("JSON 이 아니면 명확한 에러", () => {
    expect(() => parseTimeline("{{{")).toThrow("invalid-json");
  });

  it("semanticSegments 가 없으면 명확한 에러", () => {
    expect(() => parseTimeline('{"other":[]}')).toThrow("not-timeline");
  });

  it("빈 semanticSegments 는 에러가 아니라 빈 결과", () => {
    const e = parseTimeline('{"semanticSegments":[]}');
    expect(e.visits).toEqual([]);
    expect(e.tracks).toEqual([]);
    expect(e.totalVerts).toBe(0);
  });
});
