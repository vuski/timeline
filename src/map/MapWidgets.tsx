import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type { GlowStyle } from "../state/useTimelineStore";
import { Z_MAX_METERS } from "./zscale";
import { TILE_TOP_CHOICES, type TileTopN } from "../data/tiles";
import "./MapWidgets.css";

type RGBA = [number, number, number, number];

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const hexOf = (c: RGBA) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
const rgbOfHex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** 바깥 클릭·Esc 로 접는다 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

// ── 아이콘 (원본 trip 프로젝트와 같은 도형) ─────────────────────────

const ColorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
  </svg>
);

const WidthIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <line x1="2" y1="3.5" x2="14" y2="3.5" strokeWidth="1" />
    <line x1="2" y1="8" x2="14" y2="8" strokeWidth="2" />
    <line x1="2" y1="12.5" x2="14" y2="12.5" strokeWidth="3.5" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <line x1="1.5" y1="8" x2="13" y2="8" strokeWidth="1.5" />
    <path d="M9 4.5 L13.5 8 L9 11.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* 배경지도 글자 토글 — 세리프 T 하나가 "글자"를 가장 곧게 가리킨다 */
const LabelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <line x1="3" y1="3.5" x2="13" y2="3.5" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="8" y1="3.5" x2="8" y2="13" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const HeightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <line x1="8" y1="2" x2="8" y2="14" strokeWidth="1.5" />
    <path d="M5 5 L8 2 L11 5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="3" y1="14" x2="13" y2="14" strokeWidth="1.5" />
  </svg>
);

// ── 선 굵기 ─────────────────────────────────────────────────────────

export function WidthControl({
  scale, onScale,
}: { scale: number; onScale: (v: number) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className={open ? "mw mw-open" : "mw"} ref={ref}>
      {open && (
        <input
          className="mw-slider"
          type="range"
          min={0.1}
          max={2}
          step={0.05}
          value={scale}
          autoFocus
          aria-label={t("render.width")}
          onChange={(e) => onScale(Number(e.target.value))}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
      )}
      <button
        className="mw-btn"
        title={t("render.width")}
        aria-label={t("render.width")}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <WidthIcon />
      </button>
    </div>
  );
}

// ── 발광 색 (출발/도착 + 투명도) ────────────────────────────────────

export function ColorControl({
  style, onStyle,
}: { style: GlowStyle; onStyle: (s: GlowStyle) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  const row = (which: "from" | "to", label: string) => {
    const c = style[which];
    return (
      <div className="mw-row" key={which}>
        <span>{label}</span>
        <input
          type="color"
          value={hexOf(c)}
          aria-label={label}
          onChange={(e) => {
            const [r, g, b] = rgbOfHex(e.target.value);
            onStyle({ ...style, [which]: [r, g, b, c[3]] as RGBA });
          }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={c[3] / 255}
          aria-label={`${label} ${t("render.opacity")}`}
          onChange={(e) =>
            onStyle({
              ...style,
              [which]: [c[0], c[1], c[2], Math.round(Number(e.target.value) * 255)] as RGBA,
            })
          }
        />
      </div>
    );
  };

  return (
    <div className={open ? "mw mw-open" : "mw"} ref={ref}>
      {open && (
        <div className="mw-panel">
          {row("from", t("render.colorFrom"))}
          {row("to", t("render.colorTo"))}
        </div>
      )}
      <button
        className="mw-btn"
        title={t("render.colorFrom")}
        aria-label={t("render.colorFrom")}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ColorIcon />
      </button>
    </div>
  );
}

// ── 방향 화살표 토글 ────────────────────────────────────────────────

export function ArrowToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useT();
  return (
    <div className="mw">
      <button
        className={on ? "mw-btn on" : "mw-btn"}
        title={t("render.arrows")}
        aria-label={t("render.arrows")}
        aria-pressed={on}
        onClick={onToggle}
      >
        <ArrowIcon />
      </button>
    </div>
  );
}

/**
 * 격자를 몇 개만 볼지 — T 버튼 아래에 같은 폭으로 세로로 선다.
 *
 * 길게 눌러 여는 메뉴를 먼저 만들었다가 걷어냈다. 숨은 동작은 발견되지
 * 않고, 버튼 하나에 "켜고 끄기" 와 "몇 개" 두 뜻을 얹는 것도 무리였다.
 * 네 개가 늘 보이면 지금 무엇을 보고 있는지도 함께 읽힌다.
 *
 * 집계가 꺼져 있으면 고를 이유가 없으므로 아예 그리지 않는다.
 */
export function TileTopToggle({
  value,
  onValue,
}: {
  value: TileTopN;
  onValue: (n: TileTopN) => void;
}) {
  const { t } = useT();
  return (
    <div className="mw mw-col" role="group" aria-label={t("render.tileTopGroup")}>
      {TILE_TOP_CHOICES.map((n) => {
        const label = n === 0 ? t("render.tileTopAll") : t("render.tileTopN").replace("{n}", String(n));
        return (
          <button
            key={n}
            className={value === n ? "mw-btn mw-btn-text on" : "mw-btn mw-btn-text"}
            title={label}
            aria-label={label}
            aria-pressed={value === n}
            onClick={() => onValue(n)}
          >
            {/* 34px 칸에 들어가야 한다 — "전체" 는 ALL, 나머지는 숫자만 */}
            {n === 0 ? t("render.tileTopAllShort") : n}
          </button>
        );
      })}
    </div>
  );
}

export function LabelToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useT();
  return (
    <div className="mw">
      <button
        className={on ? "mw-btn on" : "mw-btn"}
        title={t("render.labels")}
        aria-label={t("render.labels")}
        aria-pressed={on}
        onClick={onToggle}
      >
        <LabelIcon />
      </button>
    </div>
  );
}

// ── z축(시간 높이) 수직 슬라이더 ────────────────────────────────────

/**
 * 시간을 고도로 쌓는 세로 슬라이더. 화면 오른쪽에 세워 두면 "위로 쌓는다"는
 * 동작과 방향이 일치한다. 0 이 기본이고 그때는 완전히 납작하다.
 */
export function ZAxisSlider({
  value, onValue, spanMeters,
}: { value: number; onValue: (v: number) => void; spanMeters: number }) {
  const { t } = useT();
  const km = Math.round(spanMeters / 1000);

  return (
    <div className="zaxis">
      <span className="zaxis-cap">{value > 0 ? `${km}km` : t("render.zAxisOff")}</span>
      <input
        className="zaxis-slider"
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={value}
        aria-label={t("render.zAxis")}
        aria-valuetext={value > 0 ? `${km} km` : t("render.zAxisOff")}
        onChange={(e) => onValue(Number(e.target.value))}
      />
      <span className="zaxis-icon" title={`${t("render.zAxis")} (max ${Z_MAX_METERS / 1000}km)`}>
        <HeightIcon />
      </span>
    </div>
  );
}
