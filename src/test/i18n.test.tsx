import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { detectLang, I18nProvider, useT } from "../i18n";
import { ko } from "../i18n/ko";
import { en } from "../i18n/en";

function Probe() {
  const { t, lang, setLang } = useT();
  return (
    <div>
      <span data-testid="text">{t("drop.title")}</span>
      <span data-testid="vars">{t("app.summary", { visits: 3, tracks: 5 })}</span>
      <button onClick={() => setLang(lang === "ko" ? "en" : "ko")}>toggle</button>
    </div>
  );
}

describe("detectLang", () => {
  it("한국어 로케일이면 ko", () => {
    expect(detectLang(["ko-KR", "en-US"])).toBe("ko");
  });

  it("그 외에는 en", () => {
    expect(detectLang(["fr-FR"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });
});

describe("사전", () => {
  const paths = (d: object): string[] =>
    Object.entries(d).flatMap(([ns, group]) =>
      Object.keys(group as object).map((k) => `${ns}.${k}`),
    );

  it("두 언어의 키 구조가 완전히 같다", () => {
    expect(paths(ko).sort()).toEqual(paths(en).sort());
  });

  it("빈 문자열이 없다", () => {
    for (const dict of [ko, en]) {
      for (const group of Object.values(dict)) {
        for (const v of Object.values(group as Record<string, string>)) {
          expect(v.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("useT", () => {
  it("언어를 바꾸면 문자열이 바뀐다", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const before = screen.getByTestId("text").textContent;
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("text").textContent).not.toBe(before);
  });

  it("변수를 끼워 넣는다", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("vars").textContent).toMatch(/3/);
    expect(screen.getByTestId("vars").textContent).toMatch(/5/);
  });
});
