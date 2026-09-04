import type { Track, Visit } from "../types";

export interface LngLat {
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** 드래그 두 모서리 → 정규화된 사각형 (방향 무관) */
export function boundsOf(a: LngLat, b: LngLat): Bounds {
  return {
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
    minLng: Math.min(a.lng, b.lng),
    maxLng: Math.max(a.lng, b.lng),
  };
}

function contains(b: Bounds, lat: number, lng: number): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function visitsIn(visits: readonly Visit[], b: Bounds): string[] {
  const out: string[] = [];
  for (const v of visits) if (contains(b, v.lat, v.lng)) out.push(v.id);
  return out;
}

/**
 * 궤적은 정점이 여럿이라 판정 기준이 필요하다:
 * **하나라도 사각형 안에 들어오면 선택** (설계 §4.5).
 * 직관적이고 계산이 싸다 — 선분 교차 판정은 이 용도에 과하다.
 */
export function tracksIn(tracks: readonly Track[], b: Bounds): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    const n = t.path.length / 2;
    for (let i = 0; i < n; i++) {
      if (contains(b, t.path[i * 2 + 1], t.path[i * 2])) {
        out.push(t.id);
        break;
      }
    }
  }
  return out;
}

export type SelectMode = "replace" | "add" | "subtract";

/** 항상 새 Set 을 돌려준다 — 원본 불변 (Global Constraints) */
export function applySelection(
  prev: ReadonlySet<string>,
  hit: readonly string[],
  mode: SelectMode,
): Set<string> {
  if (mode === "replace") return new Set(hit);
  const next = new Set(prev);
  if (mode === "add") for (const id of hit) next.add(id);
  else for (const id of hit) next.delete(id);
  return next;
}

export function invertSelection(
  prev: ReadonlySet<string>,
  all: readonly string[],
): Set<string> {
  const next = new Set<string>();
  for (const id of all) if (!prev.has(id)) next.add(id);
  return next;
}
