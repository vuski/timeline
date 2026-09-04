import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { initAnalytics } from "./analytics";
import "./styles/index.css";

// 측정 ID 가 있을 때만 붙는다 — 없으면 아무것도 하지 않는다
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
