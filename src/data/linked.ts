import type { Track, Visit } from "../types";

/**
 * 체류점을 지울 때 함께 지울 궤적 찾기.
 *
 * 체류점은 시간순으로 늘어서 있고, 점과 점 사이가 곧 이동이다:
 *
 *   점1 ──이동A── 점2 ──이동B── 점3 ──이동C── 점4
 *
 * 점2 를 지우면 점2 로 향한 이동A 도, 점2 에서 떠난 이동B 도 의미가
 * 없어진다. 남겨 두면 사라진 곳을 향해 뻗은 선만 남는다. 그래서
 * **점1 이 끝난 시각부터 점3 이 시작하는 시각까지** 의 궤적을 모두 지운다.
 *
 * 연속한 점을 여러 개 지우면 구간이 하나로 합쳐진다 — 점2,3 을 지우면
 * 점1 끝 ~ 점4 시작 전체가 대상이다.
 *
 * 좌표가 아니라 시간으로 판정하는 이유: 체류점 좌표와 궤적 끝점 좌표가
 * 정확히 일치하는 경우는 31% 뿐이다(구글이 두 값을 따로 추정한다).
 * 시간은 원본에 그대로 있으므로 어긋날 여지가 없다.
 */

/** 지울 시간 구간 [시작, 끝] — epoch ms, 양끝 포함 */
export type TimeGap = readonly [number, number];

/**
 * 지울 점들이 만드는 시간 구간 목록.
 *
 * 이웃 점(지우지 않는 것) 사이를 구간으로 잡는다. 맨 앞·맨 뒤 점을 지우면
 * 한쪽 이웃이 없으므로 그쪽은 열어 둔다(-Infinity / Infinity).
 */
export function gapsForRemovedVisits(
  removedIds: ReadonlySet<string>,
  visits: readonly Visit[],
): TimeGap[] {
  if (removedIds.size === 0) return [];

  // 시간순 정렬 — 원본이 이미 정렬돼 있지만 의존하지 않는다
  const ordered = [...visits].sort((a, b) => a.startMs - b.startMs);
  const gaps: TimeGap[] = [];

  let i = 0;
  while (i < ordered.length) {
    if (!removedIds.has(ordered[i].id)) {
      i += 1;
      continue;
    }
    // 연속으로 지워지는 구간의 끝을 찾는다
    let j = i;
    while (j + 1 < ordered.length && removedIds.has(ordered[j + 1].id)) j += 1;

    // 앞 이웃이 끝난 시각 ~ 뒤 이웃이 시작하는 시각
    const before = i > 0 ? ordered[i - 1] : null;
    const after = j + 1 < ordered.length ? ordered[j + 1] : null;
    const from = before ? Date.parse(before.end) : -Infinity;
    const to = after ? after.startMs : Infinity;
    gaps.push([Number.isFinite(from) ? from : -Infinity, to]);

    i = j + 1;
  }
  return gaps;
}

/** 궤적이 구간 하나와 겹치는가 — 조금이라도 걸치면 지운다 */
function inAnyGap(t: Track, gaps: readonly TimeGap[]): boolean {
  for (const [from, to] of gaps) {
    if (t.startMs <= to && t.endMs >= from) return true;
  }
  return false;
}

/**
 * 지울 점들에 딸려 사라질 궤적·구간의 id.
 *
 * 점을 지우면 그 점 앞뒤의 이동이 모두 대상이다 (위 그림 참고).
 */
export function tracksLinkedTo(
  removedVisitIds: ReadonlySet<string>,
  visits: readonly Visit[],
  tracks: readonly Track[],
): string[] {
  const gaps = gapsForRemovedVisits(removedVisitIds, visits);
  if (gaps.length === 0) return [];
  const out: string[] = [];
  for (const t of tracks) {
    if (inAnyGap(t, gaps)) out.push(t.id);
  }
  return out;
}
