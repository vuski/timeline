import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "../analytics";

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as { gtag?: unknown }).gtag;
});

describe("track", () => {
  /*
   * 측정 ID 가 없으면 아무것도 보내지 않아야 한다.
   *
   * 남이 이 저장소를 포크해 빌드했을 때 내 계정으로 집계가 흘러가면 안 되고,
   * 개발 중에 통계가 오염돼서도 안 된다.
   */
  it("측정 ID 가 없으면 이벤트를 보내지 않는다", () => {
    vi.stubEnv("VITE_GA_ID", "");
    const gtag = vi.fn();
    (window as { gtag?: unknown }).gtag = gtag;
    track("mode_toggle", { to: "visualize" });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("gtag 가 아직 없어도 터지지 않는다", () => {
    expect(() => track("record_start")).not.toThrow();
  });

  it("측정 ID 가 있으면 그제야 보낸다", () => {
    vi.stubEnv("VITE_GA_ID", "G-TEST123");
    const gtag = vi.fn();
    (window as { gtag?: unknown }).gtag = gtag;
    track("tile_stay_on");
    expect(gtag).toHaveBeenCalledWith("event", "tile_stay_on", undefined);
  });
});
