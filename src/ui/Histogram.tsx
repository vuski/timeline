import { useEffect, useMemo, useRef, useState } from "react";
import { dailyHistogram, monthlyHistogram, type HistoBar } from "../data/histogram";
import { DAILY_MAX_DAYS, dayNum, dayRange, monthRange, numDay, type Range } from "../data/range";
import "./FilterPanel.css";

/** 휠 1틱당 배율 · 최소 창(일) */
const ZOOM_STEP = 1.35;
const MIN_VIEW_DAYS = 2;

interface Props {
  items: readonly { start: string }[];
  range: Range | null;
  onRange: (r: Range | null) => void;
  spanFrom: string;
  spanTo: string;
  /**
   * 바깥에서 "전체 보기" 를 누른 횟수. 늘어나면 확대해 둔 창을 원래대로
   * 되돌린다 — 버튼은 날짜 입력 줄에 있지만 확대 상태는 여기 있다.
   */
  resetNonce?: number;
}

export default function Histogram({
  items, range, onRange, spanFrom, spanTo, resetNonce = 0,
}: Props) {
  const [view, setView] = useState<[string, string] | null>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pinchRef = useRef<{ dist: number; f: number } | null>(null);

  // "전체 보기" 는 기간뿐 아니라 확대해 둔 창도 되돌린다
  useEffect(() => {
    if (resetNonce > 0) setView(null);
  }, [resetNonce]);

  const viewFrom = view ? view[0] : spanFrom;
  const viewTo = view ? view[1] : spanTo;
  const viewDays = dayNum(viewTo) - dayNum(viewFrom) + 1;
  const unit: "month" | "day" = viewDays <= DAILY_MAX_DAYS ? "day" : "month";
  const barRange = unit === "day" ? dayRange : monthRange;

  const bars: HistoBar[] = useMemo(() => {
    if (unit === "day") return dailyHistogram(items, viewFrom, viewTo);
    const fromM = viewFrom.slice(0, 7);
    const toM = viewTo.slice(0, 7);
    return monthlyHistogram(items).filter((b) => b.key >= fromM && b.key <= toM);
  }, [items, unit, viewFrom, viewTo]);

  const max = Math.max(1, ...bars.map((b) => b.count));

  // 선택이 덮는 막대 구간 (드래그 중이면 드래그가 우선)
  const [lo, hi] = useMemo((): [number, number] => {
    if (drag) return [Math.min(drag.start, drag.end), Math.max(drag.start, drag.end)];
    if (!range) return [-1, -2];
    let a = -1;
    let b = -2;
    bars.forEach((bar, i) => {
      const [bf, bt] = barRange(bar.key);
      if (bt >= range.from && bf <= range.to) {
        if (a === -1) a = i;
        b = i;
      }
    });
    return [a, b];
  }, [drag, range, bars, barRange]);

  function indexAt(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || bars.length === 0) return 0;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0) return 0; // jsdom 등 레이아웃 없는 환경
    const i = Math.floor(((clientX - r.left) / r.width) * bars.length);
    return Math.max(0, Math.min(bars.length - 1, Number.isFinite(i) ? i : 0));
  }

  function commit(a: number, b: number) {
    if (bars.length === 0) return;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    onRange({ from: barRange(bars[from].key)[0], to: barRange(bars[to].key)[1] });
  }

  function onDown(e: React.PointerEvent) {
    if (e.isPrimary === false) return;
    const i = indexAt(e.clientX);
    setDrag({ start: i, end: i });
    const move = (ev: PointerEvent) =>
      setDrag((d) => (d ? { ...d, end: indexAt(ev.clientX) } : d));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit(i, indexAt(ev.clientX));
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** 창을 배율만큼 좁히거나 넓힌다 — 고정점 f(0~1)는 화면 위치를 유지한다 */
  function zoomBy(factor: number, f: number) {
    const a = dayNum(viewFrom);
    const span = dayNum(viewTo) - a + 1;
    const fullSpan = dayNum(spanTo) - dayNum(spanFrom) + 1;
    const next = Math.round(Math.min(fullSpan, Math.max(MIN_VIEW_DAYS, span * factor)));
    if (next === span) return;
    const anchor = a + f * (span - 1);
    let from = Math.round(anchor - f * (next - 1));
    from = Math.max(dayNum(spanFrom), Math.min(from, dayNum(spanTo) - next + 1));
    setView([numDay(from), numDay(from + next - 1)]);
  }

  // 핀치 줌 — 모바일에는 휠이 없다. 두 손가락 사이 거리 변화를 배율로 쓴다.
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const r = svgRef.current?.getBoundingClientRect();
    const mid = (a.clientX + b.clientX) / 2;
    pinchRef.current = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      f: r && r.width > 0 ? Math.min(1, Math.max(0, (mid - r.left) / r.width)) : 0.5,
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    const p = pinchRef.current;
    if (!p || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (p.dist <= 0 || dist <= 0) return;
    // 손가락을 벌리면(dist 증가) 창이 좁아진다 = 확대
    zoomBy(p.dist / dist, p.f);
    pinchRef.current = { ...p, dist };
  }

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  // 휠 줌 — 커서가 가리키는 시점을 고정점으로. 데스크톱 전용 보조 수단이다.
  function onWheel(e: React.WheelEvent) {
    const r = svgRef.current?.getBoundingClientRect();
    const f = r && r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5;
    zoomBy(e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, f);
  }

  return (
    <div className="histo">
      <svg
        ref={svgRef}
        data-testid="histogram"
        className="histo-svg"
        viewBox={`0 0 ${Math.max(1, bars.length)} 100`}
        preserveAspectRatio="none"
        onPointerDown={onDown}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {bars.map((b, i) => (
          <rect
            key={b.key}
            data-testid="bar"
            x={i}
            y={100 - (b.count / max) * 100}
            width={1}
            height={(b.count / max) * 100}
            className={i >= lo && i <= hi ? "histo-bar on" : "histo-bar"}
          />
        ))}
      </svg>

    </div>
  );
}
