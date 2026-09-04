import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  boundsOfRows, flattenRows, groupByDay, latestSelectedDay, rowIndexOfDay,
  windowRange, type ItemRow, type Row, type SortDir,
} from "../data/rows";
import { offsetLabel, offsetsInData, localOffset } from "../data/timezone";
import { useT, type TPath } from "../i18n";
import type { TimelineStore } from "../state/useTimelineStore";
import "./TrackList.css";

/** 행 높이(px) — 균일해야 가상 스크롤이 나눗셈 한 번으로 끝난다 */
const ROW_H = 30;

interface Props {
  store: TimelineStore;
  /** 목록에서 고른 것으로 지도를 맞춘다 */
  onFocus: (bounds: [[number, number], [number, number]]) => void;
  /** 목록 제목 — 정렬 버튼과 같은 줄에 놓는다 */
  title: string;
}

/**
 * 가져온 궤적·체류점을 날짜별로 늘어놓는 목록.
 *
 * 12년치면 항목이 3만 개가 넘어 전부 DOM 에 올리면 스크롤이 멎는다. 그래서
 * 보이는 범위만 그린다 — 행 높이가 균일하므로 스크롤 위치를 나누면 첫 행이
 * 바로 나오고, 라이브러리가 필요 없다.
 *
 * 날짜는 접혀 있는 것이 기본이다. 12년치를 전부 펼쳐 놓고 시작하면 원하는
 * 날을 찾을 수가 없다.
 *
 * 편집 모드 전용이다 — 시각화 모드에서는 화면을 지도에 다 내준다.
 */
export default function TrackList({ store, onFocus, title }: Props) {
  const { t } = useT();
  const { visibleVisits, visibleTracks, selectedIds, select, baseOffset, setBaseOffset } = store;

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<SortDir>("asc");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(320);
  /** 이 날짜를 맨 위로 — 펼치기가 반영된 다음 프레임에 옮긴다 */
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** 목록에서 스스로 고른 것인가 — 그 경우 스크롤을 옮기지 않는다 */
  const fromListRef = useRef(false);

  const grouped = useMemo(
    () => groupByDay(visibleVisits, visibleTracks, sort, baseOffset),
    [visibleVisits, visibleTracks, sort, baseOffset],
  );
  const rows = useMemo(() => flattenRows(grouped, open), [grouped, open]);

  // 스크롤 창 크기를 실제 요소에서 잰다 — 패널 높이가 화면마다 다르다
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 기간이 바뀌면 목록이 통째로 달라진다 — 맨 위로 되돌린다.
  // 날짜 목록의 모양으로 판정한다. grouped 자체를 보면 선택만 바뀌어도
  // 새 객체라 스크롤을 빼앗아, 방금 옮겨 둔 위치가 곧바로 풀린다.
  const shape = `${grouped.days.length}:${grouped.days[0]?.day ?? ""}:${grouped.days.at(-1)?.day ?? ""}`;
  const shapeRef = useRef(shape);
  useEffect(() => {
    if (shapeRef.current === shape) return;
    shapeRef.current = shape;
    boxRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [shape]);

  /**
   * 지도에서 고르면 그 날짜를 펼치고 맨 위로 올린다.
   *
   * 여러 개를 골랐으면 **가장 늦은** 날짜다. 목록에서 직접 고른 경우에는
   * 옮기지 않는다 — 방금 누른 행이 발밑에서 움직여 버린다.
   */
  useEffect(() => {
    if (fromListRef.current) {
      fromListRef.current = false;
      return;
    }
    const day = latestSelectedDay(grouped, selectedIds);
    if (day === null) return;
    setOpen((prev) => (prev.has(day) ? prev : new Set(prev).add(day)));
    setPendingDay(day);
  }, [selectedIds, grouped]);

  // 펼치기가 반영돼 행 배열이 바뀐 뒤에 옮긴다 — 그래야 위치가 정확하다
  useEffect(() => {
    if (pendingDay === null) return;
    const i = rowIndexOfDay(rows, pendingDay);
    setPendingDay(null);
    if (i < 0) return;
    const top = i * ROW_H;
    boxRef.current?.scrollTo({ top });
    setScrollTop(top);
  }, [pendingDay, rows]);

  const { start, end } = windowRange(scrollTop, viewportH, ROW_H, rows.length);
  const slice = rows.slice(start, end);

  /**
   * 날짜 헤더 — 펼치면서 그 날 전체를 선택한다.
   *
   * 접을 때는 선택을 건드리지 않는다. 접는 건 "안 볼래" 이지 "선택을
   * 풀래" 가 아니다.
   */
  const toggleDay = (day: string, ids: string[]) => {
    const opening = !open.has(day);
    setOpen((prev) => {
      const next = new Set(prev);
      if (opening) next.add(day);
      else next.delete(day);
      return next;
    });
    if (!opening) return;
    fromListRef.current = true;
    select(ids, "replace");
    const items = grouped.byDay.get(day);
    const b = items && boundsOfRows(items);
    if (b) onFocus(b);
  };

  /** 항목 클릭 — 선택하고 지도를 그리로 옮긴다 */
  const pick = (row: ItemRow, additive: boolean) => {
    fromListRef.current = true;
    select([row.id], additive ? "add" : "replace");
    const b = boundsOfRows([row]);
    if (b) onFocus(b);
  };

  // 선택지 — 데이터에 등장한 시간대 + 브라우저 시간대
  const tzOptions = useMemo(() => {
    const set = new Set(offsetsInData(store.data.visits));
    set.add(localOffset());
    return [...set].sort((a, b) => a - b);
  }, [store.data.visits]);

  const bar = (
    <div className="tracklist-bar">
      <h2 className="filter-h tracklist-title">{title}</h2>
      {/* 기준 시간대 — 바꾸면 날짜 묶기까지 다시 계산된다 */}
      <select
        className="tracklist-tz"
        value={baseOffset}
        aria-label={t("list.baseTz")}
        title={t("list.baseTz")}
        onChange={(e) => setBaseOffset(Number(e.target.value))}
      >
        {tzOptions.map((o) => (
          <option key={o} value={o}>
            {offsetLabel(o)}
          </option>
        ))}
      </select>
      <button
        className="tracklist-sort"
        onClick={() => setSort((d) => (d === "desc" ? "asc" : "desc"))}
        aria-label={t("list.sort")}
        title={t("list.sort")}
      >
        <span aria-hidden="true">{sort === "desc" ? "↓" : "↑"}</span>
        {t(sort === "desc" ? "list.sortDesc" : "list.sortAsc")}
      </button>
    </div>
  );

  if (rows.length === 0) {
    return (
      <>
        {bar}
        <p className="tracklist-empty">{t("list.empty")}</p>
      </>
    );
  }

  return (
    <>
    {bar}
    <div
      className="tracklist"
      ref={boxRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* 전체 높이를 만들어 스크롤바가 실제 길이를 갖게 한다 */}
      <div className="tracklist-space" style={{ height: rows.length * ROW_H }}>
        <div
          className="tracklist-win"
          style={{ transform: `translateY(${start * ROW_H}px)` }}
        >
          {slice.map((r) => (
            <RowView
              key={rowKey(r)}
              row={r}
              open={r.kind === "day" && open.has(r.day)}
              selected={r.kind === "item" && selectedIds.has(r.id)}
              onToggle={toggleDay}
              onPick={pick}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

/**
 * 머문 시간 표기 — "01시간 05분", 한 시간 미만이면 "05분".
 *
 * 두 자리로 채우는 이유: 목록이 세로로 늘어서므로 자릿수가 흔들리면
 * 눈이 줄을 따라가기 어렵다.
 */
function formatStay(min: number, t: (k: TPath, v?: Record<string, string | number>) => string): string {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return h > 0
    ? t("list.stayHm", { h: String(h).padStart(2, "0"), m })
    : t("list.stayM", { m });
}

function rowKey(r: Row): string {
  return r.kind === "day" ? `d:${r.day}` : `i:${r.id}`;
}

interface RowProps {
  row: Row;
  open: boolean;
  selected: boolean;
  onToggle: (day: string, ids: string[]) => void;
  onPick: (row: ItemRow, additive: boolean) => void;
  t: (k: TPath, v?: Record<string, string | number>) => string;
}

function RowView({ row, open, selected, onToggle, onPick, t }: RowProps) {
  // 날짜를 누르면 펼쳐지면서 그 날 전체가 선택된다
  if (row.kind === "day") {
    return (
      <button
        className="tracklist-day"
        style={{ height: ROW_H }}
        aria-expanded={open}
        onClick={() => onToggle(row.day, row.ids)}
      >
        <span aria-hidden="true" className={open ? "caret on" : "caret"}>
          ▸
        </span>
        <span className="tracklist-date">{row.day}</span>
        <span className="tracklist-count">{row.count}</span>
      </button>
    );
  }

  return (
    <button
      className={selected ? "tracklist-item on" : "tracklist-item"}
      style={{ height: ROW_H }}
      aria-pressed={selected}
      onClick={(e) => onPick(row, e.shiftKey || e.ctrlKey || e.metaKey)}
    >
      <span className={`tracklist-dot ${row.type}`} aria-hidden="true" />
      <span className="tracklist-time">{row.time}</span>
      <span className="tracklist-kind">
        {t(row.type === "visit" ? "list.visit" : "list.track")}
      </span>
      {/* 현지 시각 — 기준 시간대와 다를 때만 채워진다(rows.ts) */}
      {row.local && (
        <span className="tracklist-local">
          {row.local}
          <span className="tracklist-tzmark">
            {row.localOffset !== undefined ? offsetLabel(row.localOffset) : ""}
          </span>
        </span>
      )}
      {row.durMin !== undefined && (
        <span className="tracklist-dur">{formatStay(row.durMin, t)}</span>
      )}
    </button>
  );
}
