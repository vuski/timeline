import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { track } from "../analytics";
import {
  blockedByInsecureContext, canShareFiles, captureMap, copyLink, downloadImage, intentUrl,
  shareImage, snapshotName, type IntentTarget, type StampSummary,
} from "./capture";
import "./ShareSheet.css";

interface CapturableMap {
  getCanvas: () => HTMLCanvasElement;
  triggerRepaint: () => void;
}

interface Props {
  getMap: () => CapturableMap | null;
  /**
   * 집계 요약 — 이미지 아래 주소 위에 함께 새긴다.
   *
   * 격자에 적힌 비율이 무엇에 대한 비율인지 밝히는 줄이라, 그 숫자를
   * 담은 그림에는 같이 남아야 뜻이 산다.
   */
  summary?: StampSummary;
  onClose: () => void;
}

type Phase = "capturing" | "ready" | "saved" | "failed";

/* ── 아이콘 — 외부 요청 없이 그리려고 path 를 직접 둔다 ── */

const IconX = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.5l-5.1-6.6L5.8 22H2.7l7.6-8.7L1.2 2h6.6l4.6 6.1L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" />
  </svg>
);

const IconFacebook = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z" />
  </svg>
);

const IconLine = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.5 2 2 5.7 2 10.2c0 4 3.6 7.4 8.4 8 .3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 6-3.5 8.2-6 1.5-1.6 2.2-3.3 2.2-5C22.6 5.7 17.5 2 12 2ZM8 13H6.2c-.3 0-.5-.2-.5-.5V8.9c0-.3.2-.5.5-.5s.5.2.5.5v3.1H8c.3 0 .5.2.5.5s-.2.5-.5.5Zm2-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V8.9c0-.3.2-.5.5-.5s.5.2.5.5v3.6Zm4.4 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-1.9-2.5v2.2c0 .3-.2.5-.5.5s-.5-.2-.5-.5V8.9c0-.2.1-.4.3-.5h.2c.1 0 .3.1.4.2l1.9 2.6V8.9c0-.3.2-.5.5-.5s.5.2.5.5v3.6Zm3-2.3c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.8h1.2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.7c-.3 0-.5-.2-.5-.5V8.9c0-.3.2-.5.5-.5h1.7c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.8h1.2Z" />
  </svg>
);


const IconKakao = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M12 3C6.9 3 2.8 6.3 2.8 10.3c0 2.6 1.7 4.9 4.3 6.2-.2.7-.7 2.5-.8 2.9-.1.5.2.5.4.4.2-.1 2.6-1.8 3.7-2.5.5.1 1.1.1 1.6.1 5.1 0 9.2-3.3 9.2-7.3S17.1 3 12 3Z" />
  </svg>
);

const IconInstagram = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const IconLink = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M10 13a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 4.3l-1.7 1.7" />
    <path d="M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7l1.7-1.7" />
  </svg>
);

const IconDownload = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);

/**
 * 공유처 — 전부 네이티브 시트를 먼저 열고, 안 되면 intent 로 내려간다.
 *
 * intent 가 없는 곳(카카오톡·인스타그램)은 앱 키 없이 웹에서 보낼 길이
 * 없어 이미지 저장으로 떨어진다 — 앱에서 직접 올리도록.
 */
const APPS: {
  key: string;
  icon: () => React.JSX.Element;
  cls: string;
  intent?: IntentTarget;
}[] = [
  { key: "x", icon: IconX, cls: "x", intent: "x" },
  { key: "facebook", icon: IconFacebook, cls: "fb", intent: "facebook" },
  { key: "line", icon: IconLine, cls: "line", intent: "line" },
  { key: "kakao", icon: IconKakao, cls: "kakao" },
  { key: "instagram", icon: IconInstagram, cls: "insta" },
];

export default function ShareSheet({ getMap, summary, onClose }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>("capturing");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /*
   * 새김 문구 — 이미지에 굽는 것이라 바꾸면 다시 캡쳐해야 한다.
   * 타자할 때마다 다시 그리면 버거우므로, 입력값과 적용값을 나눠
   * ‘미리보기 갱신’ 을 누를 때만 굽는다.
   */
  const [caption, setCaption] = useState("");
  const [applied, setApplied] = useState("");

  useEffect(() => {
    const map = getMap();
    if (!map) {
      setPhase("failed");
      return;
    }
    let url: string | null = null;
    let alive = true;
    captureMap(map, applied, summary)
      .then((b) => {
        if (!alive) return;
        setBlob(b);
        url = URL.createObjectURL(b);
        setPreview(url);
        setPhase("ready");
      })
      .catch(() => {
        if (alive) setPhase("failed");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [getMap, applied, summary]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * 공유 — 네이티브 시트가 있으면 그쪽을 쓴다.
   *
   * 시트는 이미지까지 그대로 넘기므로 웹 인텐트(링크만 간다)보다 낫다.
   * 안 되는 환경에서만 인텐트로, 그것도 없으면 저장으로 내려간다.
   */
  const toApp = async (intent?: IntentTarget) => {
    if (!blob) return;
    /*
     * 어느 갈래로 끝났는지까지 센다 — 여는 횟수만으로는 공유가 실제로
     * 일어났는지 알 수 없다. via 는 네이티브 시트가 얼마나 통하는지를
     * 보여주고, 그게 이 화면의 설계 전제였다(시트 우선, 인텐트는 대비).
     */
    const r = await shareImage(blob, document.title);
    if (r === "shared") {
      track("share_to", { app: intent ?? "native", via: "native" });
      return;
    }
    if (intent) {
      track("share_to", { app: intent, via: "intent" });
      window.open(intentUrl(intent, document.title), "_blank", "noreferrer,noopener");
      return;
    }
    // 인스타그램·카카오톡 — 저장해서 앱에서 올리는 수밖에 없다
    track("share_to", { app: "unknown", via: "save" });
    downloadImage(blob, snapshotName());
    setPhase("saved");
  };

  const nativeOk =
    blob !== null && canShareFiles([new File([blob], "timeline.png", { type: "image/png" })]);

  return (
    <div className="share" role="dialog" aria-modal="true" aria-label={t("share.share")}>
      <div className="share-body">
        {phase === "capturing" && <p>{t("share.capturing")}</p>}
        {phase === "failed" && <p role="alert">{t("share.failed")}</p>}

        {preview && <img className="share-preview" src={preview} alt="" />}

        {blob && (
          <>
            {/* 이미지에 굽는 문구 — 주소는 항상 맨 아래에 들어간다 */}
            <label className="share-caption">
              <span>{t("share.caption")}</span>
              <input
                type="text"
                value={caption}
                maxLength={60}
                placeholder={t("share.captionPlaceholder")}
                onChange={(e) => setCaption(e.target.value)}
                onBlur={() => setApplied(caption.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setApplied(caption.trim());
                }}
              />
            </label>

            {/*
              * 앞줄 — 어디로 보낼지 OS 가 묻는다. 이미지까지 그대로 넘어가고
              * 카카오톡·인스타그램까지 덤는다.
              */}
            {nativeOk && (
              <button className="share-primary" onClick={() => void toApp()}>
                {t("share.share")}
              </button>
            )}

            <div className="share-grid">
              {/*
                * 앱별 버튼도 먼저 네이티브 시트를 열고, 안 되는 곳에서만
                * 앱마다의 대체 길(웹 인텐트 또는 저장)로 내려간다.
                *
                * 링크만 보내는 웹 인텐트보다 이미지가 함께 가는 편이 항상 낛다.
                */}
              {APPS.map(({ key, icon: Icon, cls, intent }) => (
                <button
                  key={key}
                  className={`share-app ${cls}`}
                  onClick={() => void toApp(intent)}
                >
                  <span className="share-app-icon">
                    <Icon />
                  </span>
                  {t(`share.${key}` as "share.x")}
                </button>
              ))}

              <button
                className="share-app copy"
                onClick={async () => {
                  const ok = await copyLink();
                  if (!ok) return;
                  track("share_to", { app: "link", via: "copy" });
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                <span className="share-app-icon">
                  <IconLink />
                </span>
                {copied ? t("share.copied") : t("share.copy")}
              </button>

              <button
                className="share-app save"
                onClick={() => {
                  track("share_to", { app: "file", via: "save" });
                  downloadImage(blob, snapshotName());
                  setPhase("saved");
                }}
              >
                <span className="share-app-icon">
                  <IconDownload />
                </span>
                {t("share.download")}
              </button>
            </div>

            {phase === "saved" && <p className="share-ok">{t("share.downloaded")}</p>}
            {/*
              * 시트가 안 뜼는 이유를 구분해 알린다 — 개발 중 LAN 주소로 열면
              * 브라우저가 navigator.share 를 아예 안 준다(보안 컨텍스트 규칙).
              */}
            {!nativeOk && (
              <p className="share-hint">
                {t(blockedByInsecureContext() ? "share.insecureHint" : "share.desktopHint")}
              </p>
            )}
          </>
        )}

        <button onClick={onClose}>{t("share.close")}</button>
      </div>
    </div>
  );
}
