import { useCallback, useEffect, useRef, useState } from "react";
import {
  advance, defaultSpeed, defaultTrailMs, progressOf, timeAtProgress, type Span,
} from "./timeMapping";

/**
 * 재생 루프 — **시간은 ref, 공간은 레이어**.
 *
 * currentTime 을 React state 로 두면 매 프레임 리렌더가 나서 20만 정점이
 * 60fps 를 못 낸다. 그래서 시각은 ref 에만 두고, 프레임마다 onFrame 으로
 * 흘려보낸다 — 받는 쪽이 레이어 프롭만 갈아끼운다.
 *
 * 스크러버 표시용 progress 만 state 로 두되, 매 프레임 갱신하면 같은 문제가
 * 생기므로 PROGRESS_MS 간격으로 제한한다.
 */

/** 스크러버는 초당 10번이면 충분하다 */
const PROGRESS_MS = 1000 / 10;

/**
 * 재생 상태 3단.
 *
 * - `auto`   자동 재생 — rAF 가 시각을 굴린다
 * - `manual` 수동 재생 — 시간 필터는 켜져 있고(꼬리가 보인다) 시각은
 *            사용자가 스크러버를 끌어 정한다. 루프는 돌지 않는다.
 * - `all`    정지 — 시간 필터를 끄고 전체 궤적을 한꺼번에 보여준다
 */
export type PlayMode = "auto" | "manual" | "all";

/**
 * 버튼을 누를 때 넘어가는 순서 — 정지 → 자동 → 수동.
 *
 * 정지가 시작점이다(기본 상태). 재생 버튼을 눌렀을 때 바로 흐르기 시작하는
 * 것이 기대에 맞는다. 흐르는 것을 보고 나서 직접 끌어 보고 싶어지면 한 번
 * 더 눌러 수동으로 간다.
 */
const NEXT: Record<PlayMode, PlayMode> = { all: "auto", auto: "manual", manual: "all" };

export function usePlayback(span: Span, onFrame: (t: number) => void) {
  const [mode, setMode] = useState<PlayMode>("all");
  /** 시각이 흐르는 중인가 — 루프를 걸지 결정한다 */
  const running = mode === "auto";
  /** 시간 필터(꼬리)를 적용하는가 — 자동·수동 모두 적용 */
  const timeFiltered = mode !== "all";
  const [speed, setSpeed] = useState(() => defaultSpeed(span));
  const [trailMs, setTrailMs] = useState(() => defaultTrailMs(span));
  const [progress, setProgress] = useState(0);
  /**
   * 화면에 글자로 보여줄 현재 시각(epoch ms). timeRef 와 달리 state 라
   * 리렌더를 유발하므로 progress 와 같은 저빈도(초당 10회)로만 갱신한다.
   */
  const [displayMs, setDisplayMs] = useState(span.startMs);

  const timeRef = useRef(span.startMs);
  const rafRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const lastProgressRef = useRef(0);

  // 최신 값을 루프가 읽도록 ref 에 담는다 — 루프를 매번 다시 걸지 않기 위해
  const stateRef = useRef({ span, speed, onFrame });
  stateRef.current = { span, speed, onFrame };

  // 구간이 바뀌면 시각·속도·꼬리를 새 구간에 맞춘다
  useEffect(() => {
    timeRef.current = span.startMs;
    setProgress(0);
    setDisplayMs(span.startMs);
    setSpeed(defaultSpeed(span));
    setTrailMs(defaultTrailMs(span));
    stateRef.current.onFrame(span.startMs);
  }, [span.startMs, span.endMs]);

  useEffect(() => {
    if (!running) return;
    // null = "아직 기준 프레임을 못 잡음". 0 을 센티넬로 쓰면 ts=0 인 첫
    // 프레임과 구분되지 않아 한 프레임을 통째로 잃는다.
    lastTsRef.current = null;

    const loop = (ts: number) => {
      const st = stateRef.current;
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      const delta = last === null ? 0 : ts - last;

      timeRef.current = advance(timeRef.current, delta, st.speed, st.span);
      st.onFrame(timeRef.current);

      // 스크러버만 드물게 갱신 — 매 프레임 setState 하면 리렌더가 폭발한다
      if (ts - lastProgressRef.current >= PROGRESS_MS) {
        lastProgressRef.current = ts;
        setProgress(progressOf(timeRef.current, st.span));
        setDisplayMs(timeRef.current);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  /** 정지 → 자동 → 수동 → 정지 순으로 넘어간다 */
  const cycleMode = useCallback(() => setMode((m) => NEXT[m]), []);

  const seek = useCallback((p: number) => {
    const st = stateRef.current;
    timeRef.current = timeAtProgress(p, st.span);
    setProgress(progressOf(timeRef.current, st.span));
    setDisplayMs(timeRef.current);
    st.onFrame(timeRef.current);
  }, []);

  const restart = useCallback(() => seek(0), [seek]);

  return {
    mode, setMode, cycleMode, running, timeFiltered, restart,
    speed, setSpeed,
    trailMs, setTrailMs,
    timeRef, progress, seek,
    displayMs,
  };
}

export type Playback = ReturnType<typeof usePlayback>;
