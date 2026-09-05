import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlayControls from "../play/PlayControls";
import { I18nProvider } from "../i18n";

/**
 * 재생 컨트롤의 대역 — 훅이 내놓는 모양만 흉내 낸다.
 *
 * mode 로 재생 여부를 정한다: "auto" 가 흐르는 상태, "manual" 은 손으로
 * 끄는 상태다(시각이 저절로 흐르지 않는다).
 */
function playbackStub(over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: "manual",
    cycleMode: vi.fn(),
    timeFiltered: true,
    restart: vi.fn(),
    speed: 1000,
    setSpeed: vi.fn(),
    trailMs: 60_000,
    setTrailMs: vi.fn(),
    progress: 0,
    seek: vi.fn(),
    displayMs: Date.parse("2020-01-01T00:00:00Z"),
    ...over,
  } as unknown as Parameters<typeof PlayControls>[0]["playback"];
}

function show(over = {}) {
  render(
    <I18nProvider>
      <PlayControls playback={playbackStub(over)} baseSpeed={1000} spanMs={86_400_000} />
    </I18nProvider>,
  );
}

const speed = () => screen.getByRole("slider", { name: /속도|Speed/ });
const trail = () => screen.getByRole("slider", { name: /꼬리|Trail/ });

describe("PlayControls", () => {
  /*
   * 속도는 "지금 흐르는 빠르기" 이기 전에 "재생하면 어떤 빠르기일까"
   * 라는 설정값이다. 재생 중에만 만질 수 있으면, 30 초짜리를 확인하려고
   * 매번 눌러 놓고 맞춰야 한다.
   */
  it("재생 전에도 속도를 만질 수 있다", () => {
    show({ mode: "manual" });
    expect(speed()).toBeEnabled();
  });

  it("재생 전에도 꼬리 길이를 만질 수 있다", () => {
    show({ mode: "manual" });
    expect(trail()).toBeEnabled();
  });

  it("재생 중에도 둘 다 만질 수 있다", () => {
    show({ mode: "auto" });
    expect(speed()).toBeEnabled();
    expect(trail()).toBeEnabled();
  });

  /*
   * 기본 모드가 "all"(전체 표시)이라 timeFiltered 는 false 다.
   * 그것으로 잠그면 파일을 연 직후 두 슬라이더가 모두 죽어 있었다 —
   * 실제로 겪은 버그다.
   */
  it("전체 표시 모드에서도 둘 다 만질 수 있다", () => {
    show({ mode: "all", timeFiltered: false });
    expect(speed()).toBeEnabled();
    expect(trail()).toBeEnabled();
  });
});
