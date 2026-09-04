import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useParseWorker } from "../data/useParseWorker";

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor() {
      FakeWorker.last = this;
    }
    postMessage(m: unknown) {
      this.posted.push(m);
    }
    terminate() {
      this.terminated = true;
    }
    emit(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }
  return { FakeWorker };
});

vi.mock("../data/parse.worker?worker", () => ({ default: FakeWorker }));

function fileOf(text: string): File {
  return { text: () => Promise.resolve(text) } as unknown as File;
}

const EMPTY = {
  visits: [], tracks: [], spanFrom: "", spanTo: "", totalVerts: 0, vertsByYear: {},
};

describe("useParseWorker", () => {
  beforeEach(() => {
    FakeWorker.last = null;
  });

  it("처음에는 idle", () => {
    const { result } = renderHook(() => useParseWorker());
    expect(result.current.state.phase).toBe("idle");
  });

  it("파일을 읽어 워커로 넘긴다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf('{"semanticSegments":[]}')));
    await waitFor(() => expect(FakeWorker.last?.posted).toHaveLength(1));
    expect(FakeWorker.last!.posted[0]).toEqual({ text: '{"semanticSegments":[]}' });
  });

  it("진행률을 상태로 옮긴다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf("{}")));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    act(() => FakeWorker.last!.emit({ type: "progress", pct: 42 }));
    expect(result.current.state).toEqual({ phase: "parsing", pct: 42 });
  });

  it("완료되면 데이터를 담는다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf("{}")));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    act(() => FakeWorker.last!.emit({ type: "done", data: EMPTY }));
    expect(result.current.state).toEqual({ phase: "done", data: EMPTY });
  });

  it("에러 코드를 그대로 전달한다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf("{{{")));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    act(() => FakeWorker.last!.emit({ type: "error", code: "invalid-json" }));
    expect(result.current.state).toEqual({ phase: "error", code: "invalid-json" });
  });

  it("모르는 에러 코드는 unknown 으로 좁힌다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf("{}")));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    act(() => FakeWorker.last!.emit({ type: "error", code: "무언가" }));
    expect(result.current.state).toEqual({ phase: "error", code: "unknown" });
  });

  it("reset 은 idle 로 되돌리고 워커를 끝낸다", async () => {
    const { result } = renderHook(() => useParseWorker());
    act(() => result.current.load(fileOf("{}")));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    const w = FakeWorker.last!;
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe("idle");
    expect(w.terminated).toBe(true);
  });

  it("낡은 파일 읽기가 늦게 끝나도 이미 대체된 워커에는 postMessage 하지 않는다", async () => {
    const { result } = renderHook(() => useParseWorker());

    // 첫 번째 파일의 text() 는 일부러 붙잡아 둔다 — 아직 resolve 되지 않은 상태
    let releaseFirst: (t: string) => void;
    const slowFile = {
      text: () => new Promise<string>((res) => { releaseFirst = res; }),
    } as unknown as File;

    act(() => result.current.load(slowFile));
    await waitFor(() => expect(FakeWorker.last).not.toBeNull());
    const firstWorker = FakeWorker.last!;

    // 첫 로드가 아직 postMessage 하기 전에 두 번째 로드가 대체한다
    act(() => result.current.load(fileOf('{"second":true}')));
    await waitFor(() => expect(FakeWorker.last).not.toBe(firstWorker));
    const secondWorker = FakeWorker.last!;
    await waitFor(() => expect(secondWorker.posted).toHaveLength(1));

    // 이제 낡은 첫 번째 읽기를 풀어준다 — 가드가 없다면 firstWorker 에 postMessage 된다
    await act(async () => {
      releaseFirst("첫 번째 낡은 텍스트");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(firstWorker.posted).toHaveLength(0);

    // 최종 상태는 두 번째(최신) 로드를 반영해야 한다
    const STALE = { ...EMPTY, spanFrom: "STALE" };
    const FRESH = { ...EMPTY, spanFrom: "FRESH" };
    act(() => secondWorker.emit({ type: "done", data: FRESH }));
    expect(result.current.state).toEqual({ phase: "done", data: FRESH });
    expect(result.current.state).not.toEqual({ phase: "done", data: STALE });
  });
});
