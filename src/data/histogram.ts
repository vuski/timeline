import { dayNum, numDay } from "./range";

export interface HistoBar {
  /** 월이면 "2015-06", 일이면 "2015-06-15" */
  key: string;
  count: number;
}

/**
 * 월별 개수 — 빈 달도 0 으로 채운다.
 * 빈 구간을 건너뛰면 시간축이 왜곡돼 "여행을 안 간 시기"가 보이지 않는다.
 */
export function monthlyHistogram(items: readonly { start: string }[]): HistoBar[] {
  if (items.length === 0) return [];
  const counts = new Map<string, number>();
  let min = "9999-99";
  let max = "0000-00";
  for (const it of items) {
    const k = it.start.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + 1);
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

/** [fromDay, toDay] (양끝 포함) 일별 개수 — 빈 날 포함 */
export function dailyHistogram(
  items: readonly { start: string }[],
  fromDay: string,
  toDay: string,
): HistoBar[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = it.start.slice(0, 10);
    if (k >= fromDay && k <= toDay) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const bars: HistoBar[] = [];
  const end = dayNum(toDay);
  for (let n = dayNum(fromDay); n <= end; n++) {
    const k = numDay(n);
    bars.push({ key: k, count: counts.get(k) ?? 0 });
  }
  return bars;
}
