import { useT } from "../i18n";
import { formatDuration, formatPlayDate } from "./timeMapping";
import type { PlayMode, Playback } from "./usePlayback";
import "./PlayControls.css";

/** 속도 슬라이더는 로그 스케일 — 0.5x ~ 64x 를 한 손가락으로 오간다 */
const SPEED_MIN_EXP = -1;
const SPEED_MAX_EXP = 6;

/**
 * 꼬리 길이는 절대 시간이 아니라 **구간 대비 비율**로 조절한다.
 *
 * 시간 단위로 고정하면(예: 0.2~5시간) 12년 구간에서는 꼬리가 전체의
 * 0.005% 라 점 하나로 보이고, 하루 구간에서는 꼬리가 구간을 다 덮어
 * 애니메이션이 사라진다. 비율이면 어떤 구간에서도 같은 느낌이 난다.
 */
const DAY_MS = 24 * 3600_000;
/** 꼬리 최대 — 구간의 30% */
const TRAIL_MAX_RATIO = 0.3;
/**
 * 꼬리 최소 — **하루**. 단 구간 자체가 짧으면 그 0.1% 까지 내려간다.
 *
 * 비율만으로 최소를 정하면(예: 0.2%) 12년 구간에서 최소 꼬리가 9일이라
 * "하루치만 보기" 가 불가능하다. 반대로 하루로 고정하면 하루짜리 구간에서
 * 꼬리가 구간 전체를 덮는다. 둘 중 작은 쪽을 쓴다.
 */
function trailMinMs(spanMs: number): number {
  return Math.min(DAY_MS, spanMs * 0.001);
}

/**
 * 슬라이더 위치(0~1) ↔ 꼬리 길이(ms) — **로그** 축.
 *
 * 선형으로 두면 12년 구간에서 최소(1일)와 최대(4.3년) 차이가 1500배라,
 * 짧은 꼬리 구간이 슬라이더 왼쪽 끝 1px 안에 뭉친다. 로그 축이면 하루·한
 * 주·한 달이 고르게 퍼져 실제로 집을 수 있다.
 */
function posToTrail(pos: number, spanMs: number): number {
  const lo = trailMinMs(spanMs);
  const hi = Math.max(lo * 2, spanMs * TRAIL_MAX_RATIO);
  return lo * Math.pow(hi / lo, Math.min(1, Math.max(0, pos)));
}

function trailToPos(trail: number, spanMs: number): number {
  const lo = trailMinMs(spanMs);
  const hi = Math.max(lo * 2, spanMs * TRAIL_MAX_RATIO);
  if (trail <= lo) return 0;
  if (trail >= hi) return 1;
  return Math.log(trail / lo) / Math.log(hi / lo);
}

interface Props {
  playback: Playback;
  /** 기본 속도 — 배율 표시의 기준 */
  baseSpeed: number;
  /** 현재 구간 길이(ms) — 꼬리 비율의 기준 */
  spanMs: number;
}

/** 모드별 아이콘·라벨 키 */
const MODE_UI: Record<PlayMode, { icon: string; key: "play.modeAuto" | "play.modeManual" | "play.modeAll" }> = {
  auto: { icon: "❙❙", key: "play.modeAuto" },
  manual: { icon: "✋", key: "play.modeManual" },
  all: { icon: "▶", key: "play.modeAll" },
};

export default function PlayControls({ playback, baseSpeed, spanMs }: Props) {
  const { t, lang } = useT();
  const {
    mode, cycleMode, running, timeFiltered, restart,
    speed, setSpeed, trailMs, setTrailMs, progress, seek, displayMs,
  } = playback;

  const ui = MODE_UI[mode];

  const multiple = baseSpeed > 0 ? speed / baseSpeed : 1;
  const exp = Math.log2(multiple);

  const trailPos = spanMs > 0 ? trailToPos(trailMs, spanMs) : 0;

  return (
    <div className="play">
      {/*
        3상태 토글: 전체 표시 → 자동 재생 → 수동 재생 → 전체…
        아이콘은 "지금 누르면 무엇이 되는가" 가 아니라 "지금 상태" 를
        보여준다 — 라벨이 함께 있어 헷갈리지 않는다.
      */}
      <button
        className={`play-btn play-mode-${mode}`}
        onClick={cycleMode}
        aria-label={`${t(ui.key)} — ${t("play.modeHint")}`}
        title={`${t(ui.key)} — ${t("play.modeHint")}`}
      >
        {ui.icon}
      </button>

      <span className="play-modelabel">{t(ui.key)}</span>

      <button
        className="play-btn"
        onClick={restart}
        disabled={!timeFiltered}
        aria-label={t("play.restart")}
        title={t("play.restart")}
      >
        ↺
      </button>

      <span className="play-date" aria-live="off">
        {timeFiltered ? formatPlayDate(displayMs, lang === "ko" ? "ko-KR" : "en-US") : "—"}
      </span>

      <input
        className={mode === "manual" ? "play-scrub play-scrub-active" : "play-scrub"}
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        // 전체 표시 모드에서는 시간 필터가 꺼져 있어 끌어도 화면이 안 바뀐다
        disabled={!timeFiltered}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label={t("play.play")}
      />

      {/*
        * 속도·꼬리를 한 묶음으로 — 모바일에서 한 줄에 4:6 으로 나누기 위해
        * 공통 부모가 필요하다. 데스크톱에서는 지금처럼 나란히 흘러간다.
        */}
      <div className="play-fields">
      <label className="play-field">
        <span>{t("play.speed")}</span>
        <input
          type="range"
          min={SPEED_MIN_EXP}
          max={SPEED_MAX_EXP}
          step={0.25}
          value={exp}
          // 수동·전체 표시에서는 시각이 자동으로 흐르지 않는다
          disabled={!running}
          onChange={(e) => setSpeed(baseSpeed * 2 ** Number(e.target.value))}
          aria-label={t("play.speed")}
        />
        <output>{multiple >= 1 ? `${multiple.toFixed(1)}x` : `${multiple.toFixed(2)}x`}</output>
      </label>

      <label className="play-field">
        <span>{t("play.trail")}</span>
        <input
          type="range"
          className="play-trail"
          min={0}
          max={1}
          step={0.005}
          value={trailPos}
          disabled={!timeFiltered}
          onChange={(e) => setTrailMs(posToTrail(Number(e.target.value), spanMs))}
          aria-label={t("play.trail")}
        />
        <output>
          {formatDuration(trailMs, {
            year: t("play.year"),
            month: t("play.month"),
            day: t("play.day"),
            hour: t("play.hour"),
            minute: t("play.minute"),
          })}
        </output>
      </label>
      </div>
    </div>
  );
}
