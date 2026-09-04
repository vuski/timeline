import type { Visit } from "../types";

/**
 * 기준 시간대 — 목록의 날짜·시각을 어느 시간대로 읽을지.
 *
 * 내보낸 파일은 모든 시각을 계정 홈 시간대로 맞춰둔다(실측 62,715
 * 세그먼트의 ISO 오프셋이 전부 +09:00). 그래서 원본 문자열의 오프셋은
 * 현지 시간대가 아니다. 진짜 현지 시간대는 세그먼트의
 * `startTimeTimezoneUtcOffsetMinutes` 에 들어 있고, 파서가 이를
 * `offsetMin` 으로 담는다.
 *
 * 사용자가 기준을 바꾸면 날짜 묶기까지 그 시간대로 다시 계산된다 —
 * 포르투갈 기준으로 보면 그곳의 하루가 한 덩어리로 읽힌다.
 */

/** 분 단위 UTC 오프셋 */
export type Offset = number;

/** 브라우저가 있는 곳의 오프셋(분). UTC+9 면 540 */
export function localOffset(now = new Date()): Offset {
  // getTimezoneOffset 은 부호가 반대다 (UTC+9 → -540)
  return -now.getTimezoneOffset();
}

/**
 * 데이터에서 가장 많이 쓰인 오프셋 — 기본 기준값.
 *
 * 브라우저 시간대를 기본으로 삼으면, 여행 중이거나 브라우저가 다른
 * 시간대일 때 거의 모든 행에 "현지 시각" 이 덧붙어 소음이 된다.
 * 데이터의 최빈값이면 처음 열었을 때 조용하다.
 */
export function dominantOffset(visits: readonly Visit[]): Offset | null {
  const count = new Map<number, number>();
  for (const v of visits) {
    if (typeof v.offsetMin !== "number") continue;
    count.set(v.offsetMin, (count.get(v.offsetMin) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [off, n] of count) {
    if (n > bestN) {
      best = off;
      bestN = n;
    }
  }
  return best;
}

/** 데이터에 등장하는 오프셋들 — 많이 쓰인 순. 기준 시간대 선택지 */
export function offsetsInData(visits: readonly Visit[]): Offset[] {
  const count = new Map<number, number>();
  for (const v of visits) {
    if (typeof v.offsetMin !== "number") continue;
    count.set(v.offsetMin, (count.get(v.offsetMin) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([off]) => off);
}

/** 540 → "UTC+9", -210 → "UTC-3:30", 0 → "UTC+0" */
export function offsetLabel(off: Offset): string {
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/**
 * epoch ms 를 주어진 오프셋의 "YYYY-MM-DD HH:mm" 으로.
 *
 * `Date` 의 지역 시간 메서드를 쓰면 브라우저 시간대가 끼어든다. UTC 로
 * 읽되 오프셋을 더해 옮기는 방식이라 어디서 열어도 같은 값이 나온다.
 */
export function formatAt(ms: number, off: Offset): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + off * 60000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

/** "YYYY-MM-DD" 만 */
export function dayAt(ms: number, off: Offset): string {
  return formatAt(ms, off).slice(0, 10);
}

/** "HH:mm" 만 */
export function timeAt(ms: number, off: Offset): string {
  return formatAt(ms, off).slice(11, 16);
}
