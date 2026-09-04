import type { Track } from "../types";
import { inRange, type Range } from "./range";

/**
 * 정점 예산 (설계 §2.2).
 *
 * 이 장치의 1차 목적은 **사용자가 자신이 무엇을 고르는지 보이게 하는 것**이다.
 * 강제로 깎지 않는다 — 임계를 넘을 때만 제안한다.
 */

const MOBILE_LIMIT = 200_000;
const DESKTOP_LIMIT = 600_000;

export function budgetLimit(isMobile: boolean): number {
  return isMobile ? MOBILE_LIMIT : DESKTOP_LIMIT;
}

export type Grade = "light" | "medium" | "heavy";

export function grade(verts: number, limit: number): Grade {
  if (verts >= limit) return "heavy";
  if (verts >= limit / 2) return "medium";
  return "light";
}

/** 솎은 뒤 남는 정점 수 — 양끝 보존 규칙과 일치해야 한다 */
function keptVerts(n: number, factor: number): number {
  if (factor <= 1 || n <= 2) return n;
  return Math.max(2, Math.ceil(n / factor));
}

/** 현재 구간·솎기에서 실제로 그려질 정점 수 */
export function countVerts(
  tracks: readonly Track[],
  r: Range | null,
  factor: number,
): number {
  let n = 0;
  for (const t of tracks) {
    if (!inRange(t.start, r)) continue;
    n += keptVerts(t.path.length / 2, factor);
  }
  return n;
}

/**
 * 균등 샘플링으로 정점을 솎는다 — **양 끝점은 항상 보존**한다.
 *
 * Douglas-Peucker 가 형태 보존은 낫지만 21만 점에 대한 계산 비용이 있고
 * 이 규모에선 균등 샘플링으로 충분하다. 교체가 필요해지면 이 함수 하나만
 * 바꾸면 된다 (설계 §2.2).
 *
 * 원본은 건드리지 않는다 — 새 Track 을 만들어 돌려준다.
 */
export function simplify(t: Track, factor: number): Track {
  const n = t.path.length / 2;
  if (factor <= 1 || n <= 2) return t;
  const keep = keptVerts(n, factor);
  const path = new Float64Array(keep * 2);
  const times = new Float64Array(keep);
  for (let i = 0; i < keep; i++) {
    // 마지막 칸은 반드시 원본의 마지막 정점 — 궤적의 끝이 잘리면 안 된다
    const src = i === keep - 1 ? n - 1 : Math.min(n - 1, i * factor);
    path[i * 2] = t.path[src * 2];
    path[i * 2 + 1] = t.path[src * 2 + 1];
    times[i] = t.times[src];
  }
  return { ...t, path, times };
}

/** 한계 안으로 들어가는 최소 정수 배율 */
export function suggestFactor(verts: number, limit: number): number {
  if (verts <= limit) return 1;
  return Math.ceil(verts / limit);
}
