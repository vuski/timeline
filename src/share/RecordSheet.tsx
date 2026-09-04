import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { captionLimit, VIDEO_REPO, VIDEO_TITLE } from "./record";
import "./RecordSheet.css";

export interface RecordOptions {
  caption: string;
  /** 배경지도 지명을 켠 채로 녹화할지 */
  mapLabels: boolean;
}

interface Props {
  /** 녹화 대상 캔버스 크기 — 글자 수 상한을 여기서 역산한다 */
  videoWidth: number;
  videoHeight: number;
  /** 지금 지도에 글자가 켜져 있는지 — 체크박스의 초기값 */
  labelsOn: boolean;
  /** 예상 영상 길이(이미 사람이 읽는 문자열) */
  estimate: string;
  onStart: (o: RecordOptions) => void;
  onClose: () => void;
}

/**
 * 녹화 시작 전 설정 — 하단 문구와 배경지도 글자 여부를 묻는다.
 *
 * 문구를 영상에 박은 뒤에는 고칠 수 없으니(다시 녹화해야 한다) 시작 전에
 * 한 번 확인받는 편이 낫다. 배경지도 글자도 같은 이유로 여기서 묻는다 —
 * 끄고 싶었는데 깜빡한 채로 30초를 녹화하면 처음부터 다시 해야 한다.
 */
export default function RecordSheet({
  videoWidth, videoHeight, labelsOn, estimate, onStart, onClose,
}: Props) {
  const { t } = useT();
  const [caption, setCaption] = useState("");
  const [mapLabels, setMapLabels] = useState(labelsOn);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열리면 바로 입력할 수 있게 — 이 창에 온 이유가 문구 입력이다
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const max = captionLimit(videoWidth, videoHeight);
  const left = max - caption.length;

  return (
    <div className="rec" role="dialog" aria-modal="true" aria-label={t("record.setup")}>
      <div className="rec-body">
        <h2 className="rec-title">{t("record.setup")}</h2>

        {/* 영상에 실제로 들어갈 글자를 그대로 보여 준다 — 놀랄 일을 줄인다 */}
        <div className="rec-preview" aria-label={t("record.preview")}>
          <span className="rec-preview-title">{VIDEO_TITLE}</span>
          <span className="rec-preview-repo">{VIDEO_REPO}</span>
          {/* 날짜와 문구는 하단 묶음 — 영상과 같은 순서로 */}
          <span className="rec-preview-foot">
            <span className="rec-preview-date">2015-06</span>
            <span className="rec-preview-cap">{caption}</span>
          </span>
        </div>

        <label className="rec-field">
          <span>{t("record.captionLabel")}</span>
          <input
            ref={inputRef}
            type="text"
            value={caption}
            maxLength={max}
            placeholder={t("record.captionPlaceholder")}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onStart({ caption: caption.trim(), mapLabels });
            }}
          />
          <span className="rec-count">{t("record.captionLeft", { n: left })}</span>
        </label>

        <label className="rec-check">
          <input
            type="checkbox"
            checked={mapLabels}
            onChange={(e) => setMapLabels(e.target.checked)}
          />
          {t("record.labelsOption")}
        </label>

        <div className="rec-actions">
          <button onClick={onClose}>{t("record.cancel")}</button>
          <button
            className="rec-primary"
            onClick={() => onStart({ caption: caption.trim(), mapLabels })}
          >
            {t("record.begin")}
            <span className="rec-est">{estimate}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
