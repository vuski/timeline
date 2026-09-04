import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTimelineStore } from "../state/useTimelineStore";
import type { TimelineData, Track, Visit } from "../types";

/**
 * 사용자 보고 재현: "이동구간 모드에서는 깔끔한데 궤적 우선 모드에서는
 * 점을 지워도 궤적이 일부 남는다."
 *
 * 두 원인이 있었다:
 *  1. 삭제 구간을 원본 전체(data.visits) 기준으로 잡아, 기간 필터로 빠진
 *     점이 이웃으로 잡히면서 구간이 실제보다 좁아졌다.
 *  2. 지워서 생긴 빈자리를 bridgeGaps 가 새 연결선으로 다시 이었다.
 *
 * 그래서 픽스처는 점 4개를 같은 달에 두고(기간 필터가 개입할 수 있게)
 * 그 사이마다 궤적을 깐다.
 */

const iso = (day: number, h: number) =>
  `2015-06-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000+09:00`;

const visit = (id: string, day: number, startH: number, endH: number): Visit => ({
  id,
  lat: 37 + day / 100,
  lng: 127 + day / 100,
  start: iso(day, startH),
  end: iso(day, endH),
  startMs: Date.parse(iso(day, startH)),
  placeId: null,
  semanticType: null,
});

/** 궤적 — 하루 안에서 startH~endH 동안 이동 */
const track = (id: string, day: number, startH: number, endH: number): Track => ({
  id,
  path: Float64Array.from([127, 37, 127.5, 37.5]),
  times: Float64Array.from([Date.parse(iso(day, startH)), Date.parse(iso(day, endH))]),
  startMs: Date.parse(iso(day, startH)),
  endMs: Date.parse(iso(day, endH)),
  start: iso(day, startH),
  kind: "path",
});

/**
 * 점1(1일 09~10) ─A(10~11)─ 점2(1일 11~12) ─B(12~13)─ 점3(1일 13~14)
 *                                                    ─C(14~15)─ 점4(1일 15~16)
 */
const data: TimelineData = {
  visits: [
    visit("v1", 1, 9, 10),
    visit("v2", 1, 11, 12),
    visit("v3", 1, 13, 14),
    visit("v4", 1, 15, 16),
  ],
  tracks: [track("A", 1, 10, 11), track("B", 1, 12, 13), track("C", 1, 14, 15)],
  spanFrom: "2015-06-01",
  spanTo: "2015-06-01",
  totalVerts: 6,
  vertsByYear: { "2015": 6 },
};

const setup = () => renderHook(() => useTimelineStore(data));

/** 해당 시간대에 살아남은 궤적 id (연결선 포함) */
function survivorsBetween(tracks: readonly Track[], fromH: number, toH: number): string[] {
  const from = Date.parse(iso(1, fromH));
  const to = Date.parse(iso(1, toH));
  return tracks.filter((t) => t.startMs < to && t.endMs > from).map((t) => t.id);
}

describe("점 삭제 → 그 시간대 궤적 제거 (궤적 우선 모드)", () => {
  it("가운데 점을 지우면 앞뒤 이동이 모두 사라진다", () => {
    const { result } = setup();
    act(() => result.current.select(["v2"], "replace"));
    act(() => result.current.deleteSelected());
    // v1 끝(10시) ~ v3 시작(13시) → A(10~11), B(12~13) 둘 다
    const ids = result.current.visibleTracks.map((t) => t.id);
    expect(ids).not.toContain("A");
    expect(ids).not.toContain("B");
  });

  it("지운 시간대에 아무 선도 남지 않는다 — 연결선으로 다시 잇지 않는다", () => {
    const { result } = setup();
    act(() => result.current.select(["v2"], "replace"));
    act(() => result.current.deleteSelected());
    // 10~13시 구간에 남은 선이 하나도 없어야 한다.
    // 버그였을 때: gap-A-C 같은 새 연결선이 그 자리를 이었다.
    expect(survivorsBetween(result.current.visibleTracks, 10, 13)).toEqual([]);
  });

  it("무관한 이동은 남는다", () => {
    const { result } = setup();
    act(() => result.current.select(["v2"], "replace"));
    act(() => result.current.deleteSelected());
    expect(result.current.visibleTracks.map((t) => t.id)).toContain("C");
  });

  it("연속한 두 점을 지우면 그 사이 이동이 전부 사라진다", () => {
    const { result } = setup();
    act(() => result.current.select(["v2", "v3"], "replace"));
    act(() => result.current.deleteSelected());
    // v1 끝(10시) ~ v4 시작(15시) → A, B, C 전부
    expect(survivorsBetween(result.current.visibleTracks, 10, 15)).toEqual([]);
  });

  it("삭제 되돌리기로 궤적까지 복구된다", () => {
    const { result } = setup();
    act(() => result.current.select(["v2"], "replace"));
    act(() => result.current.deleteSelected());
    act(() => result.current.restoreDeleted());
    const ids = result.current.visibleTracks.map((t) => t.id);
    expect(ids).toContain("A");
    expect(ids).toContain("B");
    expect(ids).toContain("C");
  });

  it("이동구간 모드에서도 같은 결과 — 지운 점 사이에 호가 생기지 않는다", () => {
    const { result } = setup();
    act(() => result.current.setConnectMode("arc"));
    act(() => result.current.select(["v2"], "replace"));
    act(() => result.current.deleteSelected());
    const ids = result.current.visibleTracks.map((t) => t.id);
    // v2 가 사라졌으니 v2 를 끝점으로 삼는 호는 없다
    expect(ids.some((id) => id.includes("v2"))).toBe(false);
  });
});
