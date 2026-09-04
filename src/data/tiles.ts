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
}

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
export function aggregateStays(visits: Visit[], z: number): TileStay[] {
  const byTile = new Map<string, TileStay>();

  for (const v of visits) {
    const ms = Date.parse(v.end) - Date.parse(v.start);
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
      };
      byTile.set(id, cell);
    }
    cell.minutes += ms / 60_000;
    cell.count += 1;
  }

  return [...byTile.values()];
}

/**
 * 전체 집계 시간에서 이 칸이 차지하는 비율 — "12.3%".
 *
 * 분모는 기간 전체가 아니라 **집계된 체류시간의 합**이다.
 * 기간을 분모로 잡으면 이동 중이거나 기록이 없는 시간까지 들어가
 * 모든 칸의 합이 100%에 한참 모자라는 숫자가 된다 — "머묄 시간 중
 * 어디가 몇 퍼센트인가" 를 보려는 것이므로 집계 합이 맞다.
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
