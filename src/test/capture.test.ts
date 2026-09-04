import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareFiles, captureMap, downloadImage, intentUrl, shareImage } from "../share/capture";

function fakeMap(blob: Blob | null) {
  const canvas = {
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;
  return { getCanvas: () => canvas, triggerRepaint: vi.fn() };
}

function stubRaf() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("captureMap", () => {
  it("지도를 다시 그린 뒤 캔버스를 이미지로 만든다", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const map = fakeMap(blob);
    stubRaf();
    await expect(captureMap(map)).resolves.toBe(blob);
    // 다시 그리지 않으면 지운 뒤의 빈 버퍼를 읽을 수 있다
    expect(map.triggerRepaint).toHaveBeenCalled();
  });

  it("이미지를 만들지 못하면 거절한다", async () => {
    stubRaf();
    await expect(captureMap(fakeMap(null))).rejects.toThrow("capture-failed");
  });
});

describe("canShareFiles", () => {
  it("navigator.share 가 없으면 거짓 (데스크톱 대부분)", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareFiles([new File([], "a.png")])).toBe(false);
  });

  it("canShare 가 참이면 참 (모바일)", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
    expect(canShareFiles([new File([], "a.png")])).toBe(true);
  });

  it("canShare 가 파일을 거절하면 거짓", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
    expect(canShareFiles([new File([], "a.png")])).toBe(false);
  });

  it("canShare 가 던져도 죽지 않고 거짓", () => {
    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: () => {
        throw new Error("nope");
      },
    });
    expect(canShareFiles([new File([], "a.png")])).toBe(false);
  });
});

describe("shareImage", () => {
  it("지원하면 네이티브 공유 시트를 연다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    await expect(shareImage(new Blob(["x"]), "제목")).resolves.toBe("shared");
    expect(share).toHaveBeenCalled();
  });

  it("지원하지 않으면 unsupported (호출자가 다운로드로 넘어간다)", async () => {
    vi.stubGlobal("navigator", {});
    await expect(shareImage(new Blob(["x"]), "제목")).resolves.toBe("unsupported");
  });

  /*
   * 사용자가 시트를 닫으면 브라우저는 name 이 "AbortError" 인
   * DOMException 을 던진다. 이건 실패가 아니므로 대체 길로 내려가면
   * 안 된다 — 닫았는데 파일이 받아지면 황당하다.
   */
  it("사용자가 시트를 닫은 건 실패가 아니다", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    await expect(shareImage(new Blob(["x"]), "제목")).resolves.toBe("shared");
  });

  // 진짜 실패는 호출자가 대체 길로 내려갈 수 있게 알려줘야 한다
  it("그 밖의 실패는 unsupported 로 알린다", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    await expect(shareImage(new Blob(["x"]), "제목")).resolves.toBe("unsupported");
  });
});

describe("intentUrl", () => {
  it("X 인텐트에 글이 실린다", () => {
    const u = intentUrl("x", "내 여행");
    expect(u).toContain("x.com/intent");
    expect(u).toContain(encodeURIComponent("내 여행"));
  });

  it("Facebook 인텐트를 만든다", () => {
    expect(intentUrl("facebook", "내 여행")).toContain("facebook.com/sharer");
  });
});

describe("downloadImage", () => {
  it("링크를 만들어 클릭하고 objectURL 을 정리한다", () => {
    const click = vi.fn();
    const anchor = { click, href: "", download: "" };
    vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLAnchorElement);
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    downloadImage(new Blob(["x"]), "timeline.png");
    expect(click).toHaveBeenCalled();
    expect(anchor.download).toBe("timeline.png");
    expect(anchor.href).toBe("blob:x");
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
