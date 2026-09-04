import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DropZone from "../ui/DropZone";
import { I18nProvider } from "../i18n";
import type { LoadState } from "../data/useParseWorker";

function show(state: LoadState, onFile = vi.fn()) {
  render(
    <I18nProvider>
      <DropZone state={state} onFile={onFile} />
    </I18nProvider>,
  );
  return onFile;
}

const file = new File(['{"semanticSegments":[]}'], "timeline.json", {
  type: "application/json",
});

describe("DropZone", () => {
  it("모바일용 파일 선택 입력을 항상 함께 둔다 (모바일엔 드래그가 없다)", () => {
    show({ phase: "idle" });
    expect(screen.getByLabelText(/파일 선택|Choose file/)).toBeInTheDocument();
  });

  it("파일을 놓으면 전달한다", () => {
    const onFile = show({ phase: "idle" });
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("드래그 중에는 강조하고, 벗어나면 되돌린다", () => {
    show({ phase: "idle" });
    const zone = screen.getByTestId("dropzone");
    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
    expect(zone).toHaveAttribute("data-over", "true");
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute("data-over", "false");
  });

  it("파일을 고르면 전달한다", () => {
    const onFile = show({ phase: "idle" });
    fireEvent.change(screen.getByLabelText(/파일 선택|Choose file/), {
      target: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("파싱 중에는 진행률을 보여준다", () => {
    show({ phase: "parsing", pct: 42 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("에러 코드마다 다른 안내를 보여준다", () => {
    show({ phase: "error", code: "not-timeline" });
    expect(screen.getByRole("alert").textContent).toMatch(/semanticSegments/);
  });
});

describe("파일 받는 법 안내", () => {
  /*
   * 파일이 휴대폰에 있다는 것이 이 창의 존재 이유다 —
   * 웹에서 받는 것으로 오해하면 헛걸음한다.
   */
  it("휴대폰에서 받는다고 분명히 적는다", () => {
    show({ phase: "idle" });
    fireEvent.click(screen.getByRole("button", { name: /어떻게 받나요|How do I get/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/휴대폰 안에 있습니다|lives on your phone/),
    ).toBeInTheDocument();
  });

  it("안드로이드와 아이폰 경로를 모두 준다", () => {
    show({ phase: "idle" });
    fireEvent.click(screen.getByRole("button", { name: /어떻게 받나요|How do I get/ }));
    expect(screen.getByText(/위치 서비스|Location Services/)).toBeInTheDocument();
    expect(screen.getByText(/내 타임라인 →|Your Timeline →/)).toBeInTheDocument();
  });

  it("닫으면 사라진다", () => {
    show({ phase: "idle" });
    fireEvent.click(screen.getByRole("button", { name: /어떻게 받나요|How do I get/ }));
    fireEvent.click(screen.getByRole("button", { name: /^닫기$|^Close$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("처음에는 떠 있지 않다", () => {
    show({ phase: "idle" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("개인정보 처리방침", () => {
  const openPriv = () => {
    show({ phase: "idle" });
    fireEvent.click(screen.getByRole("button", { name: /^개인정보 처리방침$|^Privacy$/ }));
  };

  it("처음에는 떠 있지 않다 — 링크를 눌러야 열린다", () => {
    show({ phase: "idle" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /*
   * 사이트를 벗어나면 안 된다. 처리방침을 보려고 눌렀는데 깃허브의
   * 마크다운 소스 화면으로 튕겨 나가면 곤란하다.
   */
  it("바깥으로 나가지 않고 그 자리에서 열린다", () => {
    openPriv();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /*
   * 이 앱을 쓰는 이유가 여기 걸려 있다 — 이 문장이 빠지면 처리방침을
   * 두는 의미가 없다.
   */
  it("데이터가 나가지 않는다는 것을 가장 먼저 말한다", () => {
    openPriv();
    expect(
      screen.getByText(/전송되지 않습니다|never uploaded anywhere/),
    ).toBeInTheDocument();
  });

  /* 앱이 대신 없애 줄 수 없는 유일한 위험이라 반드시 알려야 한다 */
  it("공용 컴퓨터에서는 파일을 지우라고 알린다", () => {
    openPriv();
    expect(screen.getByText(/휴지통|Recycle Bin/)).toBeInTheDocument();
  });

  /* 쿠키를 쓰는 쪽이라 고지 의무가 무겁다 — 끄는 법까지 적는다 */
  it("통계에 쿠키를 쓴다는 것과 끄는 법을 적는다", () => {
    openPriv();
    expect(screen.getByText(/쿠키|cookies/)).toBeInTheDocument();
    expect(screen.getByText(/광고 차단기|ad blocker/)).toBeInTheDocument();
  });

  it("제3자 요청(CARTO)을 숨기지 않는다", () => {
    openPriv();
    expect(screen.getByText(/cartocdn/)).toBeInTheDocument();
  });

  it("닫으면 사라진다", () => {
    openPriv();
    fireEvent.click(screen.getByRole("button", { name: /^닫기$|^Close$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
