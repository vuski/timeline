import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadVideo, startRecording, type FrameText, type Recording,
} from "../share/record";
import type { Playback } from "./usePlayback";

/**
 * "저장" 을 누르면 처음부터 한 바퀴 재생하며 녹화한다.
 *
 * 재생 버튼은 녹화와 무관하다 — 그냥 보고 싶을 때가 대부분이라 매번
 * 녹화하면 방해가 된다. 저장을 눌렀을 때만 시작점으로 되감고 자동 재생을
 * 켠 뒤, 한 바퀴가 끝나면 스스로 멈춘다.
 *
 * 한 바퀴의 끝은 **시각이 뒤로 뛰는 순간**으로 안다. advance() 가 구간
 * 끝에서 모듈로로 감기 때문에(timeMapping.ts) 시각이 갑자기 작아진다.
 */

export type RecordPhase = "idle" | "recording" | "saving";

export function useRecorder(
  playback: Playback,
  getCanvas: () => HTMLCanvasElement | null,
  /** 영상에 새길 글자들. 없으면 자막 없이 녹화한다 */
  getStamp?: () => FrameText,
) {
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const recRef = useRef<Recording | null>(null);
  /** 직전 프레임의 시각 — 뒤로 뛰면 한 바퀴가 끝난 것 */
  const lastTimeRef = useRef(0);
  /** 되감기 직후 첫 프레임은 판정에서 건너뛴다 */
  const armedRef = useRef(false);

  const finish = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    armedRef.current = false;
    if (!rec) return;
    setPhase("saving");
    playback.setMode("all");
    try {
      const { blob, ext } = await rec.stop();
      if (blob.size > 0) downloadVideo(blob, ext);
    } finally {
      setPhase("idle");
    }
  }, [playback]);

  /**
   * 매 프레임 호출 — 한 바퀴를 돌았는지 본다.
   * Workspace 의 onFrame 안에서 불린다(리렌더를 만들지 않는다).
   */
  const onFrame = useCallback(
    (t: number) => {
      if (!recRef.current) return;
      const prev = lastTimeRef.current;
      lastTimeRef.current = t;
      if (!armedRef.current) {
        // 되감기 직후 — 다음 프레임부터 판정한다
        if (t >= prev) armedRef.current = true;
        return;
      }
      if (t < prev) void finish();
    },
    [finish],
  );

  const start = useCallback(() => {
    if (phase !== "idle") return;
    const canvas = getCanvas();
    if (!canvas) return;
    try {
      recRef.current = startRecording(canvas, getStamp);
    } catch {
      return;
    }
    lastTimeRef.current = 0;
    armedRef.current = false;
    setPhase("recording");
    // 처음부터 한 바퀴 — 되감고 자동 재생
    playback.restart();
    playback.setMode("auto");
  }, [phase, getCanvas, playback, getStamp]);

  /** 사용자가 중간에 멈출 수 있다 — 그때까지 찍힌 만큼 저장한다 */
  const cancel = useCallback(() => {
    if (recRef.current) void finish();
  }, [finish]);

  // 페이지를 떠나거나 컴포넌트가 사라져도 트랙을 놓아 준다
  useEffect(() => {
    return () => {
      void recRef.current?.stop();
      recRef.current = null;
    };
  }, []);

  return { phase, start, cancel, onFrame };
}
