import { useCallback, useEffect, useRef, useState } from "react";
import ParseWorker from "./parse.worker?worker";
import type { TimelineData } from "../types";

export type LoadErrorCode = "invalid-json" | "not-timeline" | "unknown";

export type LoadState =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "parsing"; pct: number }
  | { phase: "done"; data: TimelineData }
  | { phase: "error"; code: LoadErrorCode };

type WorkerMsg =
  | { type: "progress"; pct: number }
  | { type: "done"; data: TimelineData }
  | { type: "error"; code: string };

const KNOWN: string[] = ["invalid-json", "not-timeline"];

export function useParseWorker() {
  const [state, setState] = useState<LoadState>({ phase: "idle" });
  const workerRef = useRef<Worker | null>(null);

  const stop = useCallback(() => {
    const w = workerRef.current;
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
    workerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const load = useCallback(
    (file: File) => {
      stop();
      setState({ phase: "reading" });
      const worker = new ParseWorker();
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
        if (workerRef.current !== worker) return; // 낡은 워커의 결과는 버린다
        const m = e.data;
        if (m.type === "progress") setState({ phase: "parsing", pct: m.pct });
        else if (m.type === "done") setState({ phase: "done", data: m.data });
        else {
          const code = KNOWN.includes(m.code) ? (m.code as LoadErrorCode) : "unknown";
          setState({ phase: "error", code });
        }
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setState({ phase: "error", code: "unknown" });
      };
      file
        .text()
        .then((text) => {
          if (workerRef.current !== worker) return;
          worker.postMessage({ text });
        })
        .catch(() => {
          if (workerRef.current !== worker) return;
          setState({ phase: "error", code: "unknown" });
        });
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState({ phase: "idle" });
  }, [stop]);

  return { state, load, reset };
}
