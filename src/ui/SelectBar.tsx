import { useT } from "../i18n";
import type { SelectMode } from "../data/select";
import type { TimelineStore } from "../state/useTimelineStore";

/* 나가기 — 글자 대신 아이콘으로 두면 모바일에서 한 줄에 들어간다 */
const IconExit = () => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

interface Props {
  store: TimelineStore;
  mode: SelectMode;
  onMode: (m: SelectMode) => void;
  /** 선택 모드를 끝낸다 — 지도 줌·팬이 다시 살아난다 */
  onExit: () => void;
}

/**
 * 선택 도구. 데스크톱은 Shift/Alt 로 추가·제외가 되지만 모바일에는
 * 수식 키가 없다 — 그래서 모드를 칩으로 항상 노출한다.
 *
 * "선택만 남기기"·"선택 삭제" 는 둘 다 1회성이다. 누르면 선택 모드를
 * 벗어나 지도를 다시 움직일 수 있는 상태로 돌아간다.
 */
export default function SelectBar({ store, mode, onMode, onExit }: Props) {
  const { t } = useT();
  const { selectedIds, invert, clearSelection, deleteSelected, keepOnlySelected } = store;
  const n = selectedIds.size;

  const MODES: { key: SelectMode; label: string }[] = [
    { key: "replace", label: t("select.replace") },
    { key: "add", label: t("select.add") },
    { key: "subtract", label: t("select.subtract") },
  ];

  return (
    <div className="selectbar">
      <div className="selectbar-modes" role="group" aria-label={t("select.mode")}>
        {MODES.map((m) => (
          <button
            key={m.key}
            className={m.key === mode ? "chip on" : "chip"}
            aria-pressed={m.key === mode}
            onClick={() => onMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <span className="selectbar-count">
        {n === 0 ? t("select.hint") : `${n} ${t("select.count")}`}
      </span>

      <div className="selectbar-actions">
        <button onClick={invert}>{t("select.invert")}</button>
        <button
          disabled={n === 0}
          onClick={() => {
            keepOnlySelected();
            onExit();
          }}
        >
          {t("select.keepOnly")}
        </button>
        <button
          disabled={n === 0}
          onClick={() => {
            deleteSelected();
            onExit();
          }}
        >
          {t("select.remove")}
        </button>
        <button
          className="selectbar-exit"
          title={t("select.exit")}
          aria-label={t("select.exit")}
          onClick={() => {
            clearSelection();
            onExit();
          }}
        >
          <IconExit />
        </button>
      </div>
    </div>
  );
}
