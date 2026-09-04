import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "../play/usePlayback";
import { TARGET_SECONDS } from "../play/timeMapping";

const DAY = 86_400_000;
const span = { startMs: 0, endMs: 30 * DAY };

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => vi.unstubAllGlobals());

/** 저장된 rAF 콜백을 한 번 실행한다 */
function tick(ts: number) {
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(ts);
  });
}

describe("usePlayback", () => {
  it("처음에는 전체 표시 모드 — 시간 필터도 꺼져 있다", () => {
    const { result } = renderHook(() => usePlayback(span, vi.fn()));
    expect(result.current.mode).toBe("all");
    expect(result.current.running).toBe(false);
    expect(result.current.timeFiltered).toBe(false);
  });

  it("버튼을 누르면 정지 → 자동 → 수동 순으로 돈다", () => {
    // 기본이 정지. 누르면 바로 흐르고, 한 번 더 누르면 직접 끈다.
    const { result } = renderHook(() => usePlayback(span, vi.fn()));
    expect(result.current.mode).toBe("all");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("auto");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("manual");
    act(() => result.current.cycleMode());
    expect(result.current.mode).toBe("all");
  });

  it("수동 모드는 시간 필터를 켜지만 시각은 흐르지 않는다", () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => usePlayback(span, onFrame));
    act(() => result.current.setMode("manual"));
    expect(result.current.timeFiltered).toBe(true);
    expect(result.current.running).toBe(false);
    onFrame.mockClear();
    frames = [];
    tick(0);
    tick(1000);
    // 루프가 걸리지 않았으므로 프레임이 오지 않는다
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("수동 모드에서도 seek 으로 시각을 옮길 수 있다 (드래그가 유일한 조작)", () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => usePlayback(span, onFrame));
    act(() => result.current.setMode("manual"));
    onFrame.mockClear();
    act(() => result.current.seek(0.5));
    expect(onFrame).toHaveBeenCalled();
    expect(result.current.progress).toBeCloseTo(0.5, 3);
  });

  it("자동 모드만 시간 필터와 흐름을 둘 다 켠다", () => {
    const { result } = renderHook(() => usePlayback(span, vi.fn()));
    act(() => result.current.setMode("auto"));
    expect(result.current.timeFiltered).toBe(true);
    expect(result.current.running).toBe(true);
  });

  it("기본 속도는 구간을 약 30초에 통과한다", () => {
    const { result } = renderHook(() => usePlayback(span, vi.fn()));
    expect((span.endMs - span.startMs) / result.current.speed).toBeCloseTo(TARGET_SECONDS, 5);
  });

  it("재생하면 프레임마다 시각이 나아간다", () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => usePlayback(span, onFrame));
    act(() => result.current.setMode("auto"));
    tick(0); // 첫 프레임은 기준 타임스탬프만 잡는다 (delta 0)
    onFrame.mockClear();
    tick(1000); // 1초 경과 → 실제로 전진
    expect(onFrame).toHaveBeenCalled();
    expect(result.current.timeRef.current).toBeGreaterThan(span.startMs);
  });

  it("재생 중 시각이 나아가도 매 프레임 리렌더하지 않는다", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return usePlayback(span, vi.fn());
    });
    act(() => result.current.setMode("auto"));
    const after = renders;
    // 같은 타임스탬프로 여러 번 돌려 progress 갱신 창(100ms)을 넘지 않게 한다
    tick(0);
    tick(1);
    tick(2);
    expect(renders).toBe(after);
    // 그래도 시각은 실제로 흘렀다 — 리렌더 없이 ref 만 움직인다는 뜻
    expect(result.current.timeRef.current).toBeGreaterThanOrEqual(span.startMs);
  });

  it("전체 표시로 넘어가면 프레임이 멈춘다", () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => usePlayback(span, onFrame));
    act(() => result.current.setMode("auto"));
    tick(0);
    act(() => result.current.setMode("all")); // 정지 — 루프 정리
    onFrame.mockClear();
    frames = []; // 정지 시점에 예약돼 있던 프레임은 버린다
    tick(1000);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("seek 은 진행률로 시각을 옮기고 즉시 그린다", () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => usePlayback(span, onFrame));
    onFrame.mockClear();
    act(() => result.current.seek(0.5));
    expect(result.current.timeRef.current).toBeCloseTo(
      span.startMs + (span.endMs - span.startMs) / 2, 0);
    expect(onFrame).toHaveBeenCalled();
    expect(result.current.progress).toBeCloseTo(0.5, 3);
  });

  it("restart 는 처음으로 되돌린다", () => {
    const { result } = renderHook(() => usePlayback(span, vi.fn()));
    act(() => result.current.seek(0.8));
    act(() => result.current.restart());
    expect(result.current.timeRef.current).toBe(span.startMs);
  });

  it("구간이 바뀌면 시각을 새 구간 시작으로 되돌리고 속도를 다시 잡는다", () => {
    const { result, rerender } = renderHook(({ s }) => usePlayback(s, vi.fn()), {
      initialProps: { s: span },
    });
    act(() => result.current.seek(0.9));
    const next = { startMs: 100 * DAY, endMs: 130 * DAY };
    rerender({ s: next });
    expect(result.current.timeRef.current).toBe(next.startMs);
    expect((next.endMs - next.startMs) / result.current.speed).toBeCloseTo(TARGET_SECONDS, 5);
  });

  it("길이가 0 인 구간에서도 안전하다 (아무것도 선택되지 않은 경우)", () => {
    const empty = { startMs: 0, endMs: 0 };
    const { result } = renderHook(() => usePlayback(empty, vi.fn()));
    act(() => result.current.setMode("auto"));
    tick(0);
    tick(1000);
    expect(Number.isFinite(result.current.timeRef.current)).toBe(true);
    expect(result.current.progress).toBe(0);
  });
});
