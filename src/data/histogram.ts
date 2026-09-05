import { dayNum, numDay } from "./range";

export interface HistoBar {
  /** 월이면 "2015-06", 일이면 "2015-06-15" */
  key: string;
  count: number;
}

/**
 * 막대에 얹을 값 — 개수가 아니라 체류 시간(분)으로 센다.
 *
 * 개수로 세면 짧은 방문 여러 번과 긴 체류 하나가 구분되지 않는다.
 * 기록이 통째로 빠진 시기를 보려면 "그 달에 몇 시간이 기록됐나" 가
 * 맞는 물음이다.
 *
 * end 가 없거나 시각이 깨진 항목은 1 로 친다 — 궤적처럼 머문 시간이
 * 없는 것도 "있었다" 는 표시는 남아야 한다.
 */
function weightOf(it: { start: string; end?: string }): number {
  if (!it.end) return 1;
  const ms = Date.parse(it.end) - Date.parse(it.start);
  return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 1;
}

export interface HistoItem {
  start: string;
  end?: string;
}

/**
 * 월별 합계 — 빈 달도 0 으로 채운다.
 * 빈 구간을 건너뛰면 시간축이 왜곡돼 "여행을 안 간 시기"가 보이지 않는다.
 *
 * 한 항목이 달을 넘어가도 쪼개지 않고 시작한 달에 통째로 넣는다.
 * 체류는 대개 하루 안쪽이라 쪼개 봐야 그림이 달라지지 않는다.
 */
export function monthlyHistogram(items: readonly HistoItem[]): HistoBar[] {
  if (items.length === 0) return [];
  const counts = new Map<string, number>();
  let min = "9999-99";
  let max = "0000-00";
  for (const it of items) {
    const k = it.start.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + weightOf(it));
    if (k < min) min = k;
    if (k > max) max = k;
  }
  const bars: HistoBar[] = [];
  let [y, m] = min.split("-").map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    bars.push({ key: k, count: counts.get(k) ?? 0 });
    if (k === max) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return bars;
}

/** [fromDay, toDay] (양끝 포함) 일별 합계 — 빈 날 포함 */
export function dailyHistogram(
  items: readonly HistoItem[],
  fromDay: string,
  toDay: string,
): HistoBar[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = it.start.slice(0, 10);
    if (k >= fromDay && k <= toDay) counts.set(k, (counts.get(k) ?? 0) + weightOf(it));
  }
  const bars: HistoBar[] = [];
  const end = dayNum(toDay);
  for (let n = dayNum(fromDay); n <= end; n++) {
    const k = numDay(n);
    bars.push({ key: k, count: counts.get(k) ?? 0 });
  }
  return bars;
}
