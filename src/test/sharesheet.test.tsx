import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShareSheet from "../share/ShareSheet";
import { I18nProvider } from "../i18n";

const map = {
  getCanvas: () =>
    ({
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/png" })),
    }) as unknown as HTMLCanvasElement,
  triggerRepaint: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:preview",
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

function show(getMap: () => typeof map | null = () => map) {
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <ShareSheet getMap={getMap} onClose={onClose} />
    </I18nProvider>,
  );
  return onClose;
}

describe("ShareSheet", () => {
  it("데스크톱에서는 이미지 저장을 1차 동선으로 준다", async () => {
    vi.stubGlobal("navigator", {});
    show();
    expect(
      await screen.findByRole("button", { name: /이미지 저장|Save image/ }),
    ).toBeInTheDocument();
  });

  it("데스크톱에서는 이미지가 안 간다는 걸 분명히 적는다", async () => {
    // https 로 열렸는데도 공유가 안 되는 경우(주로 데스크톱)
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    show();
    expect(
      await screen.findByText(/저장해 올려|Save the image to post/),
    ).toBeInTheDocument();
  });

  /*
   * 개발 중 휴대폰에서 LAN 주소(http://192.168.x.x)로 열면 브라우저가
   * navigator.share 를 아예 주지 않는다. "이 기기는 공유 불가" 가 아니라
   * 연결 방식 탓임을 알려 줘야 헛걸음하지 않는다.
   */
  it("https 가 아니어서 안 되는 건 그 이유를 적는다", async () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("navigator", {});
    show();
    expect(await screen.findByText(/https 연결|needs an https/)).toBeInTheDocument();
  });

  /*
   * 공유처는 링크가 아니라 버튼이다 — 누르면 먼저 네이티브 시트를
   * 열고(이미지까지 간다), 안 되는 환경에서만 웹 인텐트로 내려간다.
   */
  it("공유처를 버튼으로 둔다", async () => {
    vi.stubGlobal("navigator", {});
    show();
    expect(await screen.findByRole("button", { name: /^X$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Facebook$/ })).toBeInTheDocument();
  });

  /*
   * 카카오톡·인스타그램은 웹 인텐트가 없지만 네이티브 시트로는 간다.
   * 그래서 버튼은 둘다 두고, 안 되는 환경에서는 저장으로 떨어진다.
   */
  it("카카오톡·LINE·인스타그램도 같이 둔다", async () => {
    vi.stubGlobal("navigator", {});
    show();
    expect(await screen.findByRole("button", { name: /^LINE$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /카카오톡|KakaoTalk/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Instagram/ })).toBeInTheDocument();
  });

  // 누르면 네이티브 시트가 먼저 열려야 한다 — 이미지까지 가는 길이다
  it("공유처를 누르면 네이티브 시트를 시도한다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /카카오톡|KakaoTalk/ }));
    await waitFor(() => expect(share).toHaveBeenCalled());
  });

  it("링크 복사를 준다 — 인스타그램처럼 인텐트가 없는 곳으로 가는 길", async () => {
    vi.stubGlobal("navigator", {});
    show();
    expect(
      await screen.findByRole("button", { name: /링크 복사|Copy link/ }),
    ).toBeInTheDocument();
  });

  it("모바일에서는 네이티브 공유하기를 준다", async () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
    show();
    expect(await screen.findByRole("button", { name: /^공유하기$|^Share$/ })).toBeInTheDocument();
    /*
     * 네이티브가 돼도 저장 길은 남겨 둔다 — 인스타그램은 이미지를
     * 저장해 앱에서 올리는 것 말고는 방법이 없기 때문이다.
     */
    expect(screen.getByRole("button", { name: /이미지 저장|Save image/ })).toBeInTheDocument();
  });

  it("캡쳐한 이미지를 미리 보여준다", async () => {
    vi.stubGlobal("navigator", {});
    show();
    await waitFor(() => {
      const img = document.querySelector("img.share-preview") as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain("blob:preview");
    });
  });

  it("지도가 없으면 실패를 알린다", async () => {
    vi.stubGlobal("navigator", {});
    show(() => null);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
