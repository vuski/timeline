import type { Track, Visit } from "../types";
import { dayAt, timeAt, formatAt, type Offset } from "./timezone";

/**
 * 목록에 뿌릴 행 만들기.
 *
 * 화면에 보이는 것(체류점·궤적 조각)을 날짜별로 묶어 늘어놓는다. 날짜는
 * 접을 수 있는 헤더 행이고, 그 아래에 그 날의 항목이 시각 순으로 붙는다.
 *
 * 컴포넌트에서 떼어 둔 이유: 3만 행의 접기·펼치기·선택 계산이 렌더링과
 * 얽히면 무엇이 느린지 알 수 없다. 여기는 순수 함수라 그대로 잰다.
 */

/** 항목 하나 — 체류점이거나 궤적 조각 */
export interface ItemRow {
  kind: "item";
  id: string;
  /** "YYYY-MM-DD" — 원본 ISO 의 앞 10자. Date 로 바꾸지 않는다(설계 §4.2) */
  day: string;
  /** "HH:mm" */
  time: string;
  type: "visit" | "track";
  /** 머문 시간(분) — 체류점만. 이동은 없다. 표기는 UI 가 한다 */
  durMin?: number;
  /**
   * 현지 시각 "YYYY-MM-DD HH:mm" — **기준 시간대와 다를 때만** 채운다.
   * 같은 시간대 행마다 같은 값을 한 번 더 찍으면 소음이다.
   */
  local?: string;
  /** 현지 오프셋(분) — local 이 있을 때만 */
  localOffset?: number;
  /** 지도 이동에 쓸 좌표 [lng, lat] — 궤적은 첫 정점 */
  lng: number;
  lat: number;
  /** 궤적 조각의 경계 상자 [[minLng,minLat],[maxLng,maxLat]] — 체류점은 없음 */
  bounds?: [[number, number], [number, number]];
  /** 정렬용 epoch ms */
  ms: number;
}

/** 날짜 헤더 — 접기·펼치기와 그날 통째 선택의 단위 */
export interface DayRow {
  kind: "day";
  day: string;
  count: number;
  /** 그 날 항목 전체의 id — 헤더를 누르면 통째로 선택된다 */
  ids: string[];
}

export type Row = DayRow | ItemRow;

/** 목록 정렬 — 오래된순(오름차순)이 기본. 시간 흐름대로 읽힌다 */
export type SortDir = "desc" | "asc";

/** 날짜별로 묶인 항목 + 정렬된 날짜 목록 */
export interface Grouped {
  days: DayRow[];
  byDay: Map<string, ItemRow[]>;
}

/** 머문 시간(분). 끝 시각이 없거나 깨졌으면 undefined */
function stayMinutes(startMs: number, end: string): number | undefined {
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

/** 기준 시간대와 다르면 현지 표기를 붙인다 */
function localOf(
  ms: number,
  offsetMin: number | null | undefined,
  base: Offset,
): { local?: string; localOffset?: number } {
  if (typeof offsetMin !== "number" || offsetMin === base) return {};
  return { local: formatAt(ms, offsetMin), localOffset: offsetMin };
}

function trackRow(t: Track, base: Offset): ItemRow {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < t.path.length; i += 2) {
    const x = t.path[i];
    const y = t.path[i + 1];
    if (x < minLng) minLng = x;
    if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  // 표시·정렬 모두 **첫 정점의 실제 시각**을 쓴다.
  //
  // t.start 는 원본 timelinePath 블록의 시작(2시간 고정 경계)이라, 한 블록에서
  // 잘려 나온 조각 여럿이 전부 같은 시각으로 찍힌다 — 실측 2014-05-14 에서
  // 04:13·04:53·05:56 에 시작한 세 조각이 모두 "13:00" 이었다. 정렬은 정점
  // 시각으로 하는데 글자만 블록 시각이라 순서가 뒤죽박죽으로 보였다.
  const startMs = t.times.length > 0 ? t.times[0] : t.startMs;
  // 날짜도 첫 정점 기준이다. 블록 기준으로 묶으면, 23:00 블록에서 잘려 나와
  // 자정을 넘긴 조각이 전날에 붙어 "15:54 다음에 00:16" 처럼 보인다.
  return {
    kind: "item",
    id: t.id,
    day: dayAt(startMs, base),
    time: timeAt(startMs, base),
    type: "track",
    ...localOf(startMs, t.offsetMin, base),
    lng: t.path[0],
    lat: t.path[1],
    bounds: [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    ms: startMs,
  };
}

/**
 * 보이는 항목을 날짜별로 묶는다.
 *
 * 날짜 순서는 `dir` 이 정한다(기본 오래된순). 하루 **안**은 날짜 방향과 같이
 * 뒤집는다 — 오래된 순으로 볼 때 하루만 거꾸로 읽히면 이상하다.
 */
export function groupByDay(
  visits: readonly Visit[],
  tracks: readonly Track[],
  dir: SortDir = "asc",
  base: Offset = 0,
): Grouped {
  const byDay = new Map<string, ItemRow[]>();
  const push = (r: ItemRow) => {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  };

  for (const v of visits) {
    push({
      kind: "item",
      id: v.id,
      day: dayAt(v.startMs, base),
      time: timeAt(v.startMs, base),
      type: "visit",
      ...localOf(v.startMs, v.offsetMin, base),
      durMin: stayMinutes(v.startMs, v.end),
      lng: v.lng,
      lat: v.lat,
      ms: v.startMs,
    });
  }
  for (const t of tracks) {
    // 연결선(link-/arc-/gap-)은 목록에 넣지 않는다. 실제 기록이 아니라 남은
    // 점·조각 사이를 잇는 파생물이라 지우거나 고를 대상이 아니고, start 가
    // UTC 문자열이라 현지 시각으로 읽으면 9시간 어긋난 줄이 섞인다.
    if (t.path.length >= 2 && t.kind === "path") push(trackRow(t, base));
  }

  const sign = dir === "asc" ? 1 : -1;
  const days: DayRow[] = [];
  for (const [day, items] of byDay) {
    items.sort((a, b) => (a.ms - b.ms) * sign);
    days.push({ kind: "day", day, count: items.length, ids: items.map((i) => i.id) });
  }
  days.sort((a, b) => (a.day < b.day ? -sign : a.day > b.day ? sign : 0));
  return { days, byDay };
}

/**
 * 펼쳐진 날짜의 항목만 끼워 넣어 최종 행 배열을 만든다.
 *
 * 가상 스크롤은 "전체 행 수"와 "i번째 행"만 알면 되므로, 접힌 날의 항목은
 * 아예 배열에 넣지 않는다 — 접혀 있으면 계산도 하지 않는다.
 */
export function flattenRows(g: Grouped, open: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  for (const d of g.days) {
    out.push(d);
    if (!open.has(d.day)) continue;
    const list = g.byDay.get(d.day);
    if (list) out.push(...list);
  }
  return out;
}

/**
 * 창에 그릴 행의 범위 — 가상 스크롤의 전부다.
 *
 * 행 높이가 균일하므로 스크롤 위치를 나누면 첫 행이 바로 나온다. 위아래로
 * overscan 만큼 더 그려 빠르게 스크롤할 때 흰 줄이 보이지 않게 한다.
 */
export function windowRange(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  total: number,
  overscan = 6,
): { start: number; end: number } {
  if (total === 0 || rowH <= 0) return { start: 0, end: 0 };
  const first = Math.floor(scrollTop / rowH);
  const visible = Math.ceil(viewportH / rowH);
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/** 여러 항목을 모두 담는 경계 상자 — 목록에서 고른 것으로 지도를 맞출 때 */
export function boundsOfRows(
  rows: readonly ItemRow[],
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const r of rows) {
    const [[x0, y0], [x1, y1]] = r.bounds ?? [
      [r.lng, r.lat],
      [r.lng, r.lat],
    ];
    if (x0 < minLng) minLng = x0;
    if (y0 < minLat) minLat = y0;
    if (x1 > maxLng) maxLng = x1;
    if (y1 > maxLat) maxLat = y1;
  }
  if (!Number.isFinite(minLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * 궤적의 시간 범위 — "2015-06-01 09:12 ~ 09:34".
 *
 * 어느 시간대로 읽을지는 호출부가 정한다(기준 또는 그 조각의 현지).
 * 날이 넘어가면 끝에도 날짜를 붙인다.
 */
export function trackTimeRange(startMs: number, endMs: number, off: Offset): string {
  const from = formatAt(startMs, off);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return from;
  const to = formatAt(endMs, off);
  // 같은 날이면 끝은 시각만 — 날짜를 두 번 쓰면 길기만 하다
  return `${from} ~ ${to.slice(0, 10) === from.slice(0, 10) ? to.slice(11) : to}`;
}

/**
 * 선택한 것들 중 **가장 늦은** 날짜.
 *
 * 지도에서 여러 개를 집었을 때 목록을 어디로 옮길지 정한다. 마지막에 집은
 * 것이 아니라 가장 늦은 날짜다 — 집은 순서는 기억하지 않는다.
 */
export function latestSelectedDay(
  g: Grouped,
  selected: ReadonlySet<string>,
): string | null {
  if (selected.size === 0) return null;
  let best: string | null = null;
  for (const [day, items] of g.byDay) {
    if (best !== null && day <= best) continue;
    if (items.some((i) => selected.has(i.id))) best = day;
  }
  return best;
}

/** 그 날짜 헤더가 몇 번째 행인가 — 없으면 -1 */
export function rowIndexOfDay(rows: readonly Row[], day: string): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === "day" && r.day === day) return i;
  }
  return -1;
}
