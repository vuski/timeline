import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n";

describe("App", () => {
  it("타임라인 파일을 요청하는 안내를 보여준다", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: /타임라인|timeline/i })).toBeInTheDocument();
  });
});
