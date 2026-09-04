import { useEffect, useState } from "react";
import { useT, type TPath } from "../i18n";
import type { LoadState } from "../data/useParseWorker";
import heroUrl from "../assets/hero.png";
import "./DropZone.css";

const ERROR_KEY: Record<string, TPath> = {
  "invalid-json": "drop.errorInvalidJson",
  "not-timeline": "drop.errorNotTimeline",
  unknown: "drop.errorUnknown",
};

/* GitHub 마크 — 외부 요청 없이 그리려고 path 를 직접 둔다 */
const GithubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

interface Props {
  state: LoadState;
  onFile: (f: File) => void;
}

export default function DropZone({ state, onFile }: Props) {
  const { t } = useT();
  const [over, setOver] = useState(false);
  const [help, setHelp] = useState(false);
  const busy = state.phase === "reading" || state.phase === "parsing";

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  return (
    <div
      className="dropzone"
      data-testid="dropzone"
      data-over={String(over)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) onFile(f);
      }}
    >
      <h1 className="dropzone-title">{t("drop.appTitle")}</h1>
      {/*
        * 제작자 — 제목 아래 작은 회색. 새 탭으로 열고 opener 를 끊는다.
        */}
      <a
        className="dropzone-maker"
        href="https://vw-lab.com"
        target="_blank"
        rel="noreferrer noopener"
      >
        {t("drop.maker")}
      </a>

      {/*
        * 표지 그림 — 이 도구가 뭐를 만드는지 문장보다 빨리 말해 준다.
        * 번들에 담아 외부 요청 없이 띄운다.
        */}
      <img className="dropzone-hero" src={heroUrl} alt="" />

      {/* 소스 — 그림 바로 아래 */}
      <a
        className="dropzone-repo"
        href="https://github.com/vuski/timeline"
        target="_blank"
        rel="noreferrer noopener"
        title={t("drop.source")}
      >
        <GithubIcon />
        github.com/vuski/timeline
      </a>

      {/*
        * 위는 소개, 아래는 할 일 — 두 덩어리를 벌려 구분한다.
        */}
      <div className="dropzone-gap" aria-hidden="true" />

      <p className="dropzone-title-sub">{t("drop.title")}</p>
      <p className="dropzone-hint">{t("drop.hint")}</p>
      {/*
        * 이 앱을 쓰는 이유 자체라 파일을 고르기 전에 보여야 한다.
        * "믿으세요" 가 아니라 소스를 보라고 가리키는 게 핵심이다.
        */}
      <p className="dropzone-privacy">{t("drop.privacy")}</p>

      {/*
        * 파일을 어디서 받는지가 첫 관문이다 — 휴대폰에서 내보내야 하므로
        * 올리기 전에 경로를 알려 줘야 한다.
        */}
      <button className="dropzone-howto" onClick={() => setHelp(true)}>
        {t("drop.howto")}
      </button>

      {/* 모바일에는 드래그앤드롭이 없다 — 파일 선택을 항상 함께 둔다 */}
      <label className="dropzone-pick">
        {t("drop.pick")}
        <input
          type="file"
          accept=".json,application/json"
          aria-label={t("drop.pick")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </label>

      {busy && (
        <div className="dropzone-progress">
          <span>{state.phase === "reading" ? t("drop.reading") : t("drop.parsing")}</span>
          <progress
            max={100}
            value={state.phase === "parsing" ? state.pct : undefined}
            aria-valuenow={state.phase === "parsing" ? state.pct : undefined}
          />
        </div>
      )}

      {help && (
        <div
          className="howto"
          role="dialog"
          aria-modal="true"
          aria-label={t("drop.howtoTitle")}
          // 바깥을 눌러도 닫힌다 — 닫는 길을 여럿 두는 편이 안전하다
          onClick={() => setHelp(false)}
        >
          {/* 안에서 누른 클릭은 밖으로 번지지 않게 */}
          <div className="howto-body" onClick={(e) => e.stopPropagation()}>
            <h2 className="howto-title">{t("drop.howtoTitle")}</h2>
            <p className="howto-warn">{t("drop.howtoWarn")}</p>

            <h3 className="howto-h">{t("drop.howtoAndroid")}</h3>
            <p className="howto-steps">{t("drop.howtoAndroidSteps")}</p>

            <h3 className="howto-h">{t("drop.howtoIos")}</h3>
            <p className="howto-steps">{t("drop.howtoIosSteps")}</p>

            <p className="howto-result">{t("drop.howtoResult")}</p>

            <button className="howto-close" onClick={() => setHelp(false)}>
              {t("drop.howtoClose")}
            </button>
          </div>
        </div>
      )}

      {state.phase === "error" && (
        <p className="dropzone-error" role="alert">
          {t(ERROR_KEY[state.code] ?? "drop.errorUnknown")}
        </p>
      )}
    </div>
  );
}
