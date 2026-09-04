import { afterEach, describe, expect, it, vi } from "vitest";
import { initAnalytics, track } from "../analytics";

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as { gtag?: unknown }).gtag;
  delete (window as { dataLayer?: unknown }).dataLayer;
  document.querySelectorAll(`script[src*="googletagmanager"]`).forEach((el) => el.remove());
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

describe("initAnalytics", () => {
  /*
   * 이 테스트가 있는 이유 — 실제로 겪은 버그다.
   *
   * gtag 를 `(...args) => dataLayer.push(args)` 로 쓰면 진짜 배열이 들어간다.
   * 구글 공식 스니펫은 arguments(유사배열)를 넣고, gtag.js 는 그 모양을 읽는다.
   * 배열을 넣으면 태그가 항목을 못 알아보고 조용히 버려서, 스크립트는 200 으로
   * 받아오는데 collect 요청이 한 번도 안 나갔다.
   *
   * 그래서 "무엇을 넣었나"가 아니라 "어떤 모양으로 넣었나"를 검사한다.
   */
  it("dataLayer 에 배열이 아닌 arguments 모양으로 넣는다", () => {
    vi.stubEnv("VITE_GA_ID", "G-TEST123");
    initAnalytics();

    const layer = (window as { dataLayer?: unknown[] }).dataLayer;
    expect(layer).toBeDefined();
    expect(layer!.length).toBeGreaterThanOrEqual(2);

    for (const entry of layer!) {
      expect(Array.isArray(entry)).toBe(false);
      expect(typeof (entry as { length?: unknown }).length).toBe("number");
    }
  });

  it("js 와 config 를 순서대로 큐에 넣는다", () => {
    vi.stubEnv("VITE_GA_ID", "G-TEST123");
    initAnalytics();

    const layer = (window as { dataLayer?: ArrayLike<unknown>[] }).dataLayer!;
    expect(layer[0][0]).toBe("js");
    expect(layer[1][0]).toBe("config");
    expect(layer[1][1]).toBe("G-TEST123");
  });

  it("측정 ID 가 없으면 스크립트를 붙이지 않는다", () => {
    vi.stubEnv("VITE_GA_ID", "");
    initAnalytics();
    expect(document.querySelector(`script[src*="googletagmanager"]`)).toBeNull();
    expect((window as { dataLayer?: unknown }).dataLayer).toBeUndefined();
  });
});
