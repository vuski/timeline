import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTimelineStore } from "../state/useTimelineStore";
import type { TimelineData, Track, Visit } from "../types";

const visit = (id: string, lat: number, lng: number, start: string): Visit => ({
  id, lat, lng, start, end: start, startMs: Date.parse(start),
  placeId: null, semanticType: null,
});

const track = (id: string, start: string, kind: Track["kind"]): Track => ({
  id,
  path: Float64Array.from([127, 37, 127.1, 37.1]),
  times: Float64Array.from([Date.parse(start), Date.parse(start) + 60000]),
  startMs: Date.parse(start), endMs: Date.parse(start) + 60000,
  start, kind,
});

/**
 * 파서가 내놓는 모양 그대로 — 조각은 두 체류점 **사이**에 놓인다.
 * 체류 시간의 정점이 잘려 나가기 때문이다(parseTimeline.ts).
 *
 *   v0(2015-06-01) ──t0── v1(2016-06-01)
 *
 * t1 은 v1 뒤라 뒤 이웃이 없다 — 어느 점에도 딸리지 않은 조각은 그리지
 * 않는다(anchoredTracks). 그런 경우를 함께 덮으려고 남겨 둔다.
 */
const data: TimelineData = {
  visits: [
    visit("v0", 37, 127, "2015-06-01T10:00:00.000+09:00"),
    visit("v1", 38, 128, "2016-06-01T10:00:00.000+09:00"),
  ],
  tracks: [
    track("t0", "2015-06-01T12:00:00.000+09:00", "path"),
    track("t1", "2016-06-01T12:00:00.000+09:00", "path"),
  ],
  spanFrom: "2015-06-01",
  spanTo: "2016-06-01",
  totalVerts: 4,
  vertsByYear: { "2015": 2, "2016": 2 },
  moveSpans: [],
};

const setup = () => renderHook(() => useTimelineStore(data));

describe("useTimelineStore", () => {
  it("처음에는 전부 보인다 (+ 빈 시간을 메꾸는 연결선)", () => {
    const { result } = setup();
    expect(result.current.visibleVisits).toHaveLength(2);
    // 원본 궤적 2개 + 조각·체류점을 시간순으로 이은 호들
    const ids = result.current.visibleTracks.map((t) => t.id);
    expect(ids).toContain("t0");
    expect(ids).not.toContain("t1");  // v1 뒤라 딸릴 점이 없다
    expect(ids.some((id) => id.startsWith("link-"))).toBe(true);
  });

  it("기간을 좁히면 그 구간만 남는다", () => {
    const { result } = setup();
    act(() => result.current.setRange({ from: "2015-01-01T00:00", to: "2015-12-31T23:59" }));
    expect(result.current.visibleVisits.map((v) => v.id)).toEqual(["v0"]);
    // 점이 1개면 "점과 점 사이" 가 없으므로 선도 없다.
    // 선은 살아남은 점에서 도출된다 — 이동구간 모드와 같은 원리.
    expect(result.current.visibleTracks).toEqual([]);
  });

  it("기본은 궤적 우선 모드 — 원본 궤적을 쓴다", () => {
    const { result } = setup();
    expect(result.current.connectMode).toBe("path");
    const ids = result.current.visibleTracks.map((t) => t.id);
    expect(ids).toContain("t0");
    expect(ids).not.toContain("t1");  // v1 뒤라 딸릴 점이 없다
  });

  it("이동구간 모드는 원본 궤적을 버리고 체류점을 호로 잇는다", () => {
    const { result } = setup();
    act(() => result.current.setConnectMode("arc"));
    const ids = result.current.visibleTracks.map((t) => t.id);
    // 원본 궤적 id 는 하나도 없다
    expect(ids).not.toContain("t0");
    expect(ids).not.toContain("t1");
    // 체류점 2개 사이를 잇는 호 1개
    expect(ids.every((id) => id.startsWith("arc-"))).toBe(true);
    expect(ids).toHaveLength(1);
  });

  it("이동구간 모드의 호는 같은 곡률로 여러 정점을 가진다", () => {
    const { result } = setup();
    act(() => result.current.setConnectMode("arc"));
    const arc = result.current.visibleTracks[0];
    // 베지어 조각 수 + 1
    expect(arc.path.length / 2).toBe(13);
    expect(arc.times.length).toBe(13);
  });

  it("삭제한 항목은 보이지 않지만 원본은 남는다", () => {
    const { result } = setup();
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.deleteSelected());
    expect(result.current.visibleVisits.map((v) => v.id)).toEqual(["v1"]);
    expect(result.current.data.visits).toHaveLength(2); // 원본 불변
  });

  it("삭제를 되돌릴 수 있다", () => {
    const { result } = setup();
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.deleteSelected());
    act(() => result.current.restoreDeleted());
    expect(result.current.visibleVisits).toHaveLength(2);
  });

  it("삭제하면 선택이 비워진다 (사라진 것을 선택한 채로 두지 않는다)", () => {
    const { result } = setup();
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.deleteSelected());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("선택만 남기기는 선택 안 된 것을 지운다 (1회성)", () => {
    const { result } = setup();
    act(() => result.current.select(["v0", "t0"], "replace"));
    act(() => result.current.keepOnlySelected());
    expect(result.current.visibleVisits.map((v) => v.id)).toEqual(["v0"]);
    // 점 1개 → 사이가 없으니 선도 없다
    expect(result.current.visibleTracks).toEqual([]);
    // 1회성이므로 선택은 비워진다 — 남은 것을 선택한 채로 두지 않는다
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("선택만 남기기도 삭제 되돌리기로 복구된다", () => {
    const { result } = setup();
    act(() => result.current.select(["v0", "t0"], "replace"));
    act(() => result.current.keepOnlySelected());
    act(() => result.current.restoreDeleted());
    expect(result.current.visibleVisits).toHaveLength(2);
    expect(result.current.visibleTracks.map((t) => t.id)).toContain("t0");
    expect(result.current.visibleTracks.map((t) => t.id)).not.toContain("t1");
  });

  it("선택이 없으면 선택만 남기기는 아무것도 지우지 않는다", () => {
    const { result } = setup();
    act(() => result.current.keepOnlySelected());
    expect(result.current.visibleVisits).toHaveLength(2);
    expect(result.current.visibleTracks.map((t) => t.id)).toContain("t0");
    expect(result.current.visibleTracks.map((t) => t.id)).not.toContain("t1");
  });


  it("가운데 점을 지우면 그 시간대 궤적이 하나도 남지 않는다 (재현 테스트)", () => {
    const { result } = setup();
    // v0(2015-06) 를 지우면 v0 앞뒤 이동이 모두 사라져야 한다.
    // 버그였을 때: 원본 전체를 이웃으로 잡아 구간이 좁아지고 t0 이 남았고,
    // bridgeGaps 가 지운 자리를 새 선으로 다시 이었다.
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.deleteSelected());
    const from = Date.parse("2015-06-01T00:00:00.000+09:00");
    const to = Date.parse("2015-06-30T23:59:00.000+09:00");
    const survivors = result.current.visibleTracks.filter(
      (t) => t.startMs <= to && t.endMs >= from,
    );
    expect(survivors).toEqual([]);
  });

  it("지운 자리를 연결선으로 다시 잇지 않는다", () => {
    const { result } = setup();
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.deleteSelected());
    // gap- 접두 연결선이 지워진 구간을 덮으면 "지웠는데 선이 남는다"
    const rebridged = result.current.visibleTracks.filter((t) => t.id.startsWith("gap-"));
    expect(rebridged).toEqual([]);
  });

  it("선택 반전은 보이는 것 전체를 기준으로 한다", () => {
    const { result } = setup();
    act(() => result.current.select(["v0"], "replace"));
    act(() => result.current.invert());
    expect(result.current.selectedIds.has("v0")).toBe(false);
    expect(result.current.selectedIds.has("v1")).toBe(true);
    expect(result.current.selectedIds.has("t0")).toBe(true);
  });

  it("솎기 배율을 올리면 정점이 줄어든다", () => {
    const { result } = setup();
    const before = result.current.verts;
    act(() => result.current.setSimplifyFactor(2));
    expect(result.current.verts).toBeLessThanOrEqual(before);
  });

  it("현재 구간의 시간 범위를 알려준다 (재생의 재료)", () => {
    const { result } = setup();
    // t0 이 시작한 때부터, t0 을 v1 에 잇는 호가 닿는 때까지.
    // t1 은 그려지지 않으므로 재생 구간에도 들지 않는다.
    expect(result.current.span.startMs).toBe(data.tracks[0].startMs);
    expect(result.current.span.endMs).toBe(data.visits[1].startMs);
  });

  it("등급을 함께 알려준다", () => {
    const { result } = setup();
    expect(["light", "medium", "heavy"]).toContain(result.current.grade);
  });
});

describe("모드 전환과 시간 집계", () => {
  /*
   * 집계는 편집 전용이라 시각화에서는 아무것도 그리지 않는다. 켜진 채
   * 두면 편집으로 돌아왔을 때 점과 궤적이 사라진 이유를 알 길이 없다.
   */
  it("시각화로 넘어가면 집계가 풀린다", () => {
    const { result } = renderHook(() => useTimelineStore(data));

    act(() => result.current.setTileStay(true));
    expect(result.current.tileStay).toBe(true);

    act(() => result.current.setRenderMode(true));
    expect(result.current.renderMode).toBe(true);
    expect(result.current.tileStay).toBe(false);
  });

  /* 편집으로 돌아올 때는 건드리지 않는다 — 켜는 것은 사용자 몫이다 */
  it("편집으로 돌아온다고 집계가 켜지지는 않는다", () => {
    const { result } = renderHook(() => useTimelineStore(data));

    act(() => result.current.setRenderMode(true));
    act(() => result.current.setRenderMode(false));
    expect(result.current.tileStay).toBe(false);
  });
});
