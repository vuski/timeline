/**
 * 기간 필터 — 원본 ISO 문자열의 **접두 비교**로만 한다.
 *
 * 원본 startTime 은 현지 오프셋이 붙은 ISO("...T20:35:00.000+09:00")라
 * 앞자리 문자열이 곧 현지 날짜다. Date 로 바꿔 비교하면 브라우저 시간대로
 * 밀려서, 해외에서 찍은 기록이 하루씩 어긋난다.
 */
export interface Range {
  /** "YYYY-MM-DDTHH:mm" */
  from: string;
  to: string;
}

/** to 의 끝을 포함시키기 위한 상한 문자 — 유니코드 최대 문자 */
const HIGH = "￿";

export function inRange(startIso: string, r: Range | null): boolean {
  if (!r) return true;
  return startIso >= r.from && startIso <= r.to + HIGH;
}

export function filterByRange<T extends { start: string }>(
  items: readonly T[],
  r: Range | null,
): T[] {
  if (!r) return items as T[];
  return items.filter((x) => inRange(x.start, r));
}

/** 월 키("2015-06") → 그 달 전체 구간 */
export function monthRange(key: string): [string, string] {
  const [y, m] = key.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 은 1-기반 → 다음 달 0일
  return [`${key}-01T00:00`, `${key}-${String(lastDay).padStart(2, "0")}T23:59`];
}

/** 일 키("2015-06-15") → 그 날 전체 구간 */
export function dayRange(key: string): [string, string] {
  return [`${key}T00:00`, `${key}T23:59`];
}

/** 창이 이 일수 이하로 좁아지면 일별 막대로 전환한다 */
export const DAILY_MAX_DAYS = 92;

// 날짜 산술만 UTC epoch 일수로 — 표기는 다시 ISO 앞자리로 돌아온다
export const dayNum = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
export const numDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
