/**
 * 체류 집계 — 구글 지도가 쓰는 웹 메르카토르 XYZ 타일 격자.
 *
 * 점 하나하나를 보는 대신 "이 동네에 얼마나 오래 있었나"를 본다. 12년치를
 * 한 화면에 놓으면 점이 겹쳐 어디가 오래 머문 곳인지 알 수 없기 때문이다.
 *
 * 타일 격자를 쓰는 이유는 구글 지도와 같은 좌표계라 경계가 배경지도와
 * 어긋나지 않아서다. 위경도 도(度) 격자는 위도가 높아질수록 칸이 가로로
 * 늘어나 왜곡된다.
 */

import type { Visit } from "../types";

/** 타일 한 칸의 집계 결과 */
export interface TileStay {
  /** "z/x/y" — 안정적인 키 */
  id: string;
  x: number;
  y: number;
  z: number;
  /** 이 칸에서 머문 총 시간(분) */
  minutes: number;
  /** 이 칸에 든 체류점 수 */
  count: number;
  /** 칸의 경계 [[lng,lat] × 4] — deck.gl PolygonLayer 에 그대로 넘긴다 */
  polygon: [number, number][];
  /** 라벨을 놓을 자리 — 칸 한가운데 */
  center: [number, number];
  /**
   * 언제 머물렀나 — 전체 기간을 HIST_BINS 칸으로 쪼갠 분 단위 누적.
   *
   * 방문 목록을 그대로 들고 있으면 칸마다 수천 개가 쌓인다(실측 18,364
   * 방문). 툴팁 막대는 34칸뿐이므로 집계할 때 바로 칸에 부어 넣는다.
   */
  hist: number[];
}

/**
 * 툴팁 히스토그램의 칸 수.
 *
 * 폭 101px 에 막대 2px + 간격 1px 로 채우면 34칸이다(34*3 - 1 = 101).
 * 12년이면 한 칸이 약 4.3개월이다.
 */
export const HIST_BINS = 34;

/**
 * 표시 줌 — 지도 줌에서 격자 줌을 역산한다.
 *
 * 참조 프로젝트(trip 관리자 페이지)는 +2 였고(한 칸이 화면에서 약 64px),
 * 여기서는 한 단계 더 잘게 본다(사용자 지정) — 칸이 절반 폭이 돼
 * 동네 단위로 구분된다. 상한을 15 로 같이 올려야 맨 끝까지 확대했을 때도
 * 한 단계 더 잘게 보는 규칙이 유지된다.
 */
export function displayZoom(mapZoom: number): number {
  // 지도 줌은 0 보다 작아지지 않으므로 아래쪽은 자연히 3 이 하한이다
  return Math.min(15, Math.max(0, Math.floor(mapZoom)) + 3);
}

/** 위도 한계 — 웹 메르카토르는 극지방을 무한대로 늘리므로 잘라 낸다 */
const MAX_LAT = 85.0511287798066;

/** 경도 → 타일 x (실수. 정수부가 타일 번호, 소수부가 칸 안 위치) */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** 위도 → 타일 y. 메르카토르 투영이라 로그가 들어간다 */
export function latToTileY(lat: number, z: number): number {
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** 타일 한 칸의 네 모서리 — 시계 반대 방향 */
export function tilePolygon(x: number, y: number, z: number): [number, number][] {
  const w = tileXToLng(x, z);
  const e = tileXToLng(x + 1, z);
  const n = tileYToLat(y, z);
  const s = tileYToLat(y + 1, z);
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ];
}

/**
 * 체류점들을 타일별로 묶어 머문 시간을 더한다.
 *
 * 한 점의 체류 시간은 end - start 다. 점을 통째로 한 칸에 넣는다 —
 * 체류란 "한 자리에 머문 것"이라 칸을 걸쳐 나눌 이유가 없다.
 */
/** 방문들이 걸쳐 있는 기간 — 히스토그램 가로축의 기본값 */
function spanOf(visits: Visit[]): Span | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const v of visits) {
    const a = Date.parse(v.start);
    const b = Date.parse(v.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    if (a < min) min = a;
    if (b > max) max = b;
  }
  return Number.isFinite(min) && max > min ? { startMs: min, endMs: max } : undefined;
}

export interface Span {
  startMs: number;
  endMs: number;
}

export function aggregateStays(visits: Visit[], z: number, span?: Span): TileStay[] {
  const byTile = new Map<string, TileStay>();
  /*
   * 히스토그램의 가로축 — 기간을 주지 않으면 방문에서 직접 잡는다.
   * 어느 쪽이든 모든 칸이 같은 축을 써야 서로 견줄 수 있다.
   */
  const axis = span ?? spanOf(visits);
  const axisLen = axis ? axis.endMs - axis.startMs : 0;

  for (const v of visits) {
    const startMs = Date.parse(v.start);
    const ms = Date.parse(v.end) - startMs;
    // 시각이 깨졌거나 순서가 뒤집힌 점은 건너뛴다
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const x = Math.floor(lngToTileX(v.lng, z));
    const y = Math.floor(latToTileY(v.lat, z));
    const id = `${z}/${x}/${y}`;

    let cell = byTile.get(id);
    if (!cell) {
      const polygon = tilePolygon(x, y, z);
      cell = {
        id,
        x,
        y,
        z,
        minutes: 0,
        count: 0,
        polygon,
        center: [tileXToLng(x + 0.5, z), tileYToLat(y + 0.5, z)],
        hist: new Array<number>(HIST_BINS).fill(0),
      };
      byTile.set(id, cell);
    }
    cell.minutes += ms / 60_000;
    cell.count += 1;

    /*
     * 시작 시각이 드는 칸에 통째로 넣는다. 한 방문이 칸 경계를 넘어가도
     * 쪼개지 않는다 — 한 칸이 넉 달인데 방문은 대개 하루 안쪽이라
     * 쪼개 봐야 그림이 달라지지 않는다.
     */
    if (axis && axisLen > 0) {
      const t = (startMs - axis.startMs) / axisLen;
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(t * HIST_BINS)));
      cell.hist[bin] += ms / 60_000;
    }
  }

  return [...byTile.values()];
}

/**
 * 이 칸이 차지하는 비율 — "12.3%".
 *
 * 분모는 **기간 전체**다. 앞서는 집계된 체류시간의 합을 분모로 삼았는데,
 * 화면에 분모가 적히지 않아 보는 사람이 당연히 "전체 기간 중"으로 읽었다.
 * 실측 63MB 파일에서 그 차이가 컸다 — 같은 칸이 체류 기준 95%, 전체 기준
 * 86% 로 나왔다(체류 10년 10개월 vs 전체 12년 4개월).
 *
 * 그래서 분모를 직관과 맞췄다. 대신 칸들의 합은 100%에 못 미치며,
 * 모자라는 몫이 이동 시간이다 — 화면의 요약 줄이 그 몫을 밝힌다.
 */
export function stayShare(minutes: number, totalMinutes: number): string {
  if (!(totalMinutes > 0)) return "";
  // 둘째 자리에서 반올림해 첫째 자리까지
  return `${((minutes / totalMinutes) * 100).toFixed(1)}%`;
}

export interface StayUnits {
  hour: string;
  day: string;
  month: string;
  year: string;
}

const HOURS_PER_DAY = 24;
/** 사용자 지정 — 한 달은 30일로 셈한다 */
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
/**
 * 표기상 한 해는 열두 달이다.
 *
 * 365/30 = 12.17 을 쓰면 "1년 12개월" 이 새어나온다 — 반올림해서
 * 12 가 된 것을 12.17 미만이라고 통과시켜 버리기 때문이다.
 */
const MONTHS_PER_YEAR = 12;

/**
 * 체류 시간 표기 — 칸 위에 얹을 짧은 글자.
 *
 * 규칙(사용자 지정):
 *  - 72시간까지는 시간
 *  - 그 위로 30일(=한 달)까지는 일
 *  - 그 위로 365일까지는 개월
 *  - 365일이 넘으면 "N년 M개월"
 *
 * 칸 위에 얹는 글자라 짧아야 한다. 그래서 큰 단위 하나(+년일 때만 개월)만 쓴다.
 */
export function formatStayLong(minutes: number, u: StayUnits): string {
  const hours = minutes / 60;
  if (hours < 72) return `${Math.round(hours)}${u.hour}`;

  const days = hours / HOURS_PER_DAY;
  if (days <= DAYS_PER_MONTH) return `${Math.round(days)}${u.day}`;

  if (days <= DAYS_PER_YEAR) {
    const months = days / DAYS_PER_MONTH;
    // 12개월로 반올림되면 "12개월" 대신 해로 넘긴다
    const rounded = Math.round(months);
    if (rounded < MONTHS_PER_YEAR) return `${rounded}${u.month}`;
    return `1${u.year}`;
  }

  const years = Math.floor(days / DAYS_PER_YEAR);
  const restMonths = Math.round((days - years * DAYS_PER_YEAR) / DAYS_PER_MONTH);
  // 반올림이 열두 달을 채우면 해를 올린다 ("1년 12개월" 방지)
  if (restMonths >= MONTHS_PER_YEAR) return `${years + 1}${u.year}`;
  return restMonths > 0 ? `${years}${u.year} ${restMonths}${u.month}` : `${years}${u.year}`;
}

/**
 * 로그 눈금 위치 — 0(가장 짧음) 에서 1(가장 길음) 사이.
 *
 * 체류시간은 자릿수가 다르다 — 집은 2,589일인데 잠깐 들른 곳은 1시간이다.
 * 선형으로 칠하면 집만 진하고 99%가 같은 색이 되고(실측), 자연 분류로
 * 잘라도 최상위 계급이 1.5일~2,589일을 한데 묶어 의미가 없었다.
 *
 * 로그는 "10배 더 오래 = 한 단계 진하게" 로 읽힌다 — 자릿수 차이를
 * 그대로 보여 준다.
 */
export function logScale(value: number, min: number, max: number): number {
  if (!(max > 0)) return 0;
  // 0 이 들어오면 log 가 -∞ 로 간다. 밑을 1분으로 받친다
  const lo = Math.log(Math.max(1, min));
  const hi = Math.log(Math.max(1, max));
  if (hi - lo < 1e-9) return 1;
  const v = Math.log(Math.max(1, value));
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/* ── 기간 요약 ─────────────────────────────────────────────────────── */

export interface StaySummary {
  /** 첫 기록부터 마지막 기록까지 (분) */
  totalMinutes: number;
  /** 체류로 잡힌 시간의 합 (분) */
  stayMinutes: number;
  /** 이동으로 잡힌 시간의 합 (분) */
  moveMinutes: number;
  /** 어느 쪽으로도 기록이 없는 시간 (분) */
  gapMinutes: number;
  /** 0~100, 반올림해 정수. 셋을 더하면 100 이 된다 */
  stayPct: number;
  movePct: number;
  gapPct: number;
}

interface Range {
  a: number;
  b: number;
}

/** 겹치는 구간을 합친다 — 겹친 시간을 두 번 세지 않기 위해 */
function mergeRanges(list: Range[]): Range[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((x, y) => x.a - y.a);
  const out: Range[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.a <= last.b) last.b = Math.max(last.b, cur.b);
    else out.push({ ...cur });
  }
  return out;
}

/**
 * [from, to] 안에 든 몫만 더한다 — 창에 걸친 구간은 잘라서.
 *
 * 사용자가 기간을 아무렇게나 좁혀도 셈이 맞아야 한다. 걸친 구간을 통째로
 * 세면 창보다 긴 시간이 나오고, 통째로 버리면 창 대부분을 덮는 긴 체류가
 * 사라진다.
 */
function clipTotal(list: Range[], from: number, to: number): number {
  let sum = 0;
  for (const r of list) {
    const a = Math.max(r.a, from);
    const b = Math.min(r.b, to);
    if (b > a) sum += b - a;
  }
  return sum;
}

/**
 * 화면 위 요약 줄에 쓸 숫자 — "총 12년 4개월 중 체류 10년 9개월(87%),
 * 이동 1년 4개월(11%), 기록 없음 91일(2%)".
 *
 * 기간은 첫 기록과 마지막 기록 사이로 잡는다. 사용자가 고른 구간이 아니라
 * 실제 데이터가 있는 범위여야 비율이 뜻을 갖는다.
 *
 * **이동과 공백을 갈라 센다.** 앞서는 전체에서 체류를 뺀 나머지를 통째로
 * 이동이라 불렀는데, 실측 파일에서 그 나머지 580일 중 91일은 이동이 아니라
 * 아무 기록도 없는 시간이었다. 히스토그램을 체류 시간으로 그려 보니 몇 달이
 * 통째로 꺼져 있었고, 그것을 "이동" 이라 부르는 것은 사실이 아니다.
 *
 * 겹치는 구간은 합쳐서 센다 — 실측 파일에 겹치는 방문이 1,035쌍 있었고,
 * 그대로 더하면 합이 100% 를 넘는다.
 */
export function summarize(
  visits: Visit[],
  moveSpans: readonly (readonly [number, number])[] = [],
  window?: Span,
): StaySummary | undefined {
  const stayRanges: Range[] = [];
  for (const v of visits) {
    const a = Date.parse(v.start);
    const b = Date.parse(v.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    stayRanges.push({ a, b });
  }

  const stay = mergeRanges(stayRanges);
  const move = mergeRanges(
    moveSpans
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
      .map(([a, b]) => ({ a, b })),
  );

  /*
   * 셈의 바깥 테두리.
   *
   * 창을 주면 그것을 쓰고, 없으면 실제 기록이 있는 범위로 잡는다.
   * 사용자가 기간을 좁히면 창이 들어오는데, 그때는 창에 걸친 구간을
   * 잘라서 세야 한다 — 창 밖으로 뻗은 체류·이동을 통째로 세면 비율이
   * 100% 를 넘는다.
   */
  const from = window?.startMs ?? Math.min(stay[0]?.a ?? Infinity, move[0]?.a ?? Infinity);
  const to =
    window?.endMs ??
    Math.max(stay[stay.length - 1]?.b ?? -Infinity, move[move.length - 1]?.b ?? -Infinity);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return undefined;

  const clipped = clipTotal(stay, from, to);
  const bothClipped = clipTotal(mergeRanges([...stay, ...move]), from, to);

  const totalMinutes = (to - from) / 60_000;
  const stayMinutes = clipped / 60_000;
  /*
   * 이동은 체류와 겹치는 몫을 뺀다. 구글은 같은 시간에 체류와 이동을 함께
   * 기록하기도 하는데, 그대로 더하면 합이 100% 를 넘는다. 체류를 우선으로
   * 두는 것은 "어디에 있었나" 가 이 화면의 물음이기 때문이다.
   */
  const moveMinutes = Math.max(0, (bothClipped - clipped) / 60_000);
  const gapMinutes = Math.max(0, totalMinutes - stayMinutes - moveMinutes);

  const stayPct = Math.round((stayMinutes / totalMinutes) * 100);
  const movePct = Math.round((moveMinutes / totalMinutes) * 100);

  return {
    totalMinutes,
    stayMinutes,
    moveMinutes,
    gapMinutes,
    stayPct,
    movePct,
    // 셋을 따로 반올림하면 합이 99 나 101 이 된다 — 남는 몫을 공백에 준다
    gapPct: Math.max(0, 100 - stayPct - movePct),
  };
}

/**
 * 기간 표기 — 요약 줄용. 칸 위 글자(formatStayLong)와 규칙이 다르다.
 *
 * 사용자 지정: 365일 이하는 일 단위, 그 위는 "N년 M개월".
 */
export function formatSpan(minutes: number, u: StayUnits): string {
  const days = minutes / 60 / HOURS_PER_DAY;
  if (days <= DAYS_PER_YEAR) return `${Math.round(days)}${u.day}`;

  const years = Math.floor(days / DAYS_PER_YEAR);
  const months = Math.round((days - years * DAYS_PER_YEAR) / DAYS_PER_MONTH);
  // 12개월로 반올림되면 해를 올린다 ("1년 12개월" 방지)
  if (months >= MONTHS_PER_YEAR) return `${years + 1}${u.year}`;
  return months > 0 ? `${years}${u.year} ${months}${u.month}` : `${years}${u.year}`;
}

/* ── 툴팁 ──────────────────────────────────────────────────────────── */

/** 막대 2px, 간격 1px — 34칸이면 정확히 101px */
const HIST_BAR_W = 2;
const HIST_GAP = 1;
const HIST_H = 22;
/** 바닥 축선 두께 — 막대(2px)보다 굵게 둬야 축으로 읽힌다 */
const HIST_AXIS_H = 3;
export const HIST_W = HIST_BINS * (HIST_BAR_W + HIST_GAP) - HIST_GAP;

/**
 * 체류 시간을 모든 단위로 풀어 쓴다 — "2년 3개월 14일 7시간".
 *
 * 칸 위 글자(formatStayLong)는 큰 단위 하나로 뭉뚱그리지만("3개월"),
 * 툴팁은 실제로 얼마인지 보려는 자리라 남는 단위까지 모두 적는다.
 *
 * 셈은 사용자 지정 — 1년 365일, 1개월 30일. 달력이 아니라 고정 길이라
 * 12개월(360일)이 1년(365일)보다 짧다. 그래서 formatStayLong 이 겪은
 * "1년 12개월" 문제가 여기서는 생기지 않는다.
 *
 * 0 인 단위는 건너뛴다 — "2년 0개월 14일" 은 읽기만 나쁘다. 다만 값이
 * 아주 작아 모든 단위가 0 이면 "0시간" 이라도 남긴다.
 */
export function formatStayFull(minutes: number, u: StayUnits): string {
  // 시간 이하는 정수로 반올림 — 분·초까지 보여줄 자리가 아니다
  let hours = Math.round(minutes / 60);

  const perYear = DAYS_PER_YEAR * HOURS_PER_DAY;
  const perMonth = DAYS_PER_MONTH * HOURS_PER_DAY;

  const years = Math.floor(hours / perYear);
  hours -= years * perYear;
  const months = Math.floor(hours / perMonth);
  hours -= months * perMonth;
  const days = Math.floor(hours / HOURS_PER_DAY);
  hours -= days * HOURS_PER_DAY;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}${u.year}`);
  if (months > 0) parts.push(`${months}${u.month}`);
  if (days > 0) parts.push(`${days}${u.day}`);
  if (hours > 0) parts.push(`${hours}${u.hour}`);
  return parts.length > 0 ? parts.join(" ") : `0${u.hour}`;
}

/**
 * 전체 기간 중 비율 — 툴팁용. 소수점 다섯째 자리까지(사용자 지정).
 *
 * 칸에는 "1.2%" 로 적히는데, 짧게 머문 칸은 그 표기에서 모두 0.0% 가 된다.
 * 툴팁은 원본 수치를 보는 자리라 자리를 늘려 구분이 되게 한다.
 */
export function formatShareExact(minutes: number, totalMinutes: number): string {
  if (!(totalMinutes > 0)) return "";
  return `${((minutes / totalMinutes) * 100).toFixed(5)}%`;
}

/**
 * 언제 머물렀는지를 막대로 — 전체 기간을 가로축에 펼친 작은 그래프.
 *
 * 칸 안의 최대값에 맞춰 높이를 잡는다. 전체 최대값에 맞추면 집을 뺀
 * 나머지 칸이 모두 납작해져 시기를 읽을 수 없다.
 *
 * SVG 로 그린다 — 막대 34개라 DOM 부담이 없고, 캔버스와 달리 툴팁이
 * 다시 그려질 때 초기화 순서를 신경 쓸 일이 없다.
 */
export function histogramSvg(hist: number[]): string {
  const max = Math.max(...hist, 0);
  const bars = hist
    .map((v, i) => {
      const x = i * (HIST_BAR_W + HIST_GAP);
      // 값이 있으면 최소 1px — 짧은 체류도 있었다는 것은 보여야 한다
      const h = max > 0 && v > 0 ? Math.max(1, Math.round((v / max) * HIST_H)) : 0;
      if (h === 0) return "";
      return `<rect x="${x}" y="${HIST_H - h}" width="${HIST_BAR_W}" height="${h}"/>`;
    })
    .join("");
  /*
   * 아래에 축선을 하나 긋는다 — 막대가 어디서부터 올라온 것인지 바닥이
   * 보여야 높이가 읽힌다. 막대보다 진하게 두어 축과 값을 구분한다.
   */
  const axis = `<rect class="tip-hist-axis" x="0" y="${HIST_H}" width="${HIST_W}" height="${HIST_AXIS_H}"/>`;
  const h = HIST_H + HIST_AXIS_H;
  return `<svg class="tip-hist" width="${HIST_W}" height="${h}" viewBox="0 0 ${HIST_W} ${h}">${bars}${axis}</svg>`;
}
