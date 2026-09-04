import { parseTimeline } from "./parseTimeline";

/**
 * 63MB JSON 파싱 전용 워커.
 * 메인 스레드에서 하면 브라우저가 몇 초 멈춘다 (설계 §2.1).
 */
self.onmessage = (e: MessageEvent<{ text: string }>) => {
  try {
    const data = parseTimeline(e.data.text, (pct) => {
      self.postMessage({ type: "progress", pct });
    });
    // Float64Array 버퍼를 소유권 이전으로 넘긴다 — 구조적 복제 비용이 사라진다
    const transfer: ArrayBuffer[] = [];
    for (const t of data.tracks) {
      transfer.push(t.path.buffer as ArrayBuffer, t.times.buffer as ArrayBuffer);
    }
    self.postMessage({ type: "done", data }, transfer);
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    self.postMessage({ type: "error", code });
  }
};
