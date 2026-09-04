import type { Track, Visit } from "../types";

/**
 * 점과 점을 잇는 선을 만드는 두 가지 방식.
 *
 * - `path`  궤적 우선 — 실측 GPS 궤적 조각을 쓰고, 조각 사이·체류점과의
 *           연결은 호로 잇는다. 실제로 지나간 길에 가장 가깝다.
 * - `arc`   이동구간 — 궤적을 통째로 무시하고 체류점만 순서대로 호로
 *           잇는다. 실제 경로는 아니지만 "어디서 어디로" 가 한눈에 보인다.
 *
 * 두 모드 모두 원본을 그대로 들고 있으므로 언제든 오갈 수 있다.
 */
export type ConnectMode = "path" | "arc";

/** 호의 곡률 — 제어점 수직 오프셋 비율. 곡선 중앙은 이 값의 절반만큼 벗어난다 */
export const ARC_BEND = 0.1;
/**
 * 호를 몇 조각으로 쪼갤지.
 *
 * 12 로 잡는다 — 곡률 0.1 은 얕은 호라 12 조각으로도 화면에서 매끄럽고,
 * 정점 예산이 3배 가벼워진다. 실측 표본(체류점 1.8만)에서 32 조각이면
 * 60.6만 정점으로 모바일 한계(20만)를 세 배 넘겼다. 12 조각이면 23.9만.
 */
export const ARC_SEGMENTS = 12;

/**
 * 두 점을 잇는 2차 베지어 호. 모든 호가 같은 곡률이라 여러 개가 겹쳐도
 * 규칙적으로 보인다.
 */
export function arcPath(
  from: readonly [number, number],
  to: readonly [number, number],
  segments = ARC_SEGMENTS,
  bend = ARC_BEND,
): number[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // 제어점을 직선의 수직 방향으로 밀어 곡선을 만든다
  const cx = x1 + dx / 2 - dy * bend;
  const cy = y1 + dy / 2 + dx * bend;
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out.push(
      u * u * x1 + 2 * u * t * cx + t * t * x2,
      u * u * y1 + 2 * u * t * cy + t * t * y2,
    );
  }
  return out;
}

/** 체류점 사이를 호로 이은 궤적들 — 이동구간 모드 */
export function arcTracks(visits: readonly Visit[]): Track[] {
  if (visits.length < 2) return [];
  const ordered = [...visits].sort((a, b) => a.startMs - b.startMs);
  const out: Track[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const coords = arcPath([a.lng, a.lat], [b.lng, b.lat]);
    const n = coords.length / 2;
    // 출발 시각 = 앞 점이 떠난 때, 도착 시각 = 뒤 점에 닿은 때
    const t0 = Date.parse(a.end);
    const t1 = b.startMs;
    const from = Number.isFinite(t0) ? t0 : a.startMs;
    const span = t1 - from;
    const times = new Float64Array(n);
    for (let k = 0; k < n; k++) times[k] = from + (span * k) / (n - 1);
    out.push({
      id: `arc-${a.id}-${b.id}`,
      path: Float64Array.from(coords),
      times,
      startMs: from,
      endMs: t1,
      start: a.end,
      kind: "activity",
    });
  }
  return out;
}

/** 궤적 조각의 첫 점 / 끝 점 [lng, lat] */
function firstPoint(t: Track): [number, number] {
  return [t.path[0], t.path[1]];
}
function lastPoint(t: Track): [number, number] {
  const n = t.path.length / 2;
  return [t.path[(n - 1) * 2], t.path[(n - 1) * 2 + 1]];
}

/** 시간순으로 늘어놓을 때의 한 항목 — 궤적 조각이거나 체류점이다 */
type Node =
  | { kind: "track"; at: number; endAt: number; track: Track }
  | { kind: "visit"; at: number; endAt: number; visit: Visit };

function nodeEndPoint(n: Node): [number, number] {
  return n.kind === "track" ? lastPoint(n.track) : [n.visit.lng, n.visit.lat];
}
function nodeStartPoint(n: Node): [number, number] {
  return n.kind === "track" ? firstPoint(n.track) : [n.visit.lng, n.visit.lat];
}

/**
 * 궤적 조각과 체류점을 시간순으로 이어 하나의 선 묶음으로 만든다 — 궤적 우선 모드.
 *
 * 파서가 체류 시간의 정점을 잘라내므로(parseTimeline.ts) 궤적은 "이동한
 * 부분" 만 남은 조각들이다. 그 조각들과 체류점을 시각 순으로 늘어놓고,
 * 이웃한 둘 사이를 호로 잇는다:
 *
 *   조각A ══> [호] ══> 체류1 ══> [호] ══> 조각B ══> [호] ══> 체류2
 *   └직선┘                                 └직선┘
 *
 * 조각 **안** 은 실측 GPS 라 직선 그대로 두고(Track 이 이미 그렇게 그려진다),
 * 조각과 조각 사이는 호로 잇는다 — GPS 가 끊긴 몇 시간이 섞여 있을 수 있어
 * 직선으로 그으면 실측이 아닌 선을 실측처럼 보여주게 된다.
 *
 * 이 함수는 **잇는 선만** 돌려준다. 조각 자체는 호출부가 그대로 그린다.
 */
export function linkNodes(
  tracks: readonly Track[],
  visits: readonly Visit[],
): Track[] {
  const nodes: Node[] = [];
  for (const t of tracks) {
    if (t.path.length >= 4) {
      nodes.push({ kind: "track", at: t.startMs, endAt: t.endMs, track: t });
    }
  }
  for (const v of visits) {
    const e = Date.parse(v.end);
    nodes.push({
      kind: "visit",
      at: v.startMs,
      endAt: Number.isFinite(e) ? e : v.startMs,
      visit: v,
    });
  }
  if (nodes.length < 2) return [];
  nodes.sort((a, b) => a.at - b.at);

  const out: Track[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const from = nodeEndPoint(a);
    const to = nodeStartPoint(b);
    // 같은 자리면 선이 필요 없다 (체류점과 그 옆 조각이 겹쳐 있는 경우)
    if (from[0] === to[0] && from[1] === to[1]) continue;
    const coords = arcPath(from, to);
    const n = coords.length / 2;
    const t0 = a.endAt;
    const t1 = Math.max(b.at, t0);
    const times = new Float64Array(n);
    for (let k = 0; k < n; k++) times[k] = t0 + ((t1 - t0) * k) / (n - 1);
    out.push({
      id: `link-${nodeId(a)}-${nodeId(b)}`,
      path: Float64Array.from(coords),
      times,
      startMs: t0,
      endMs: t1,
      start: new Date(t0).toISOString(),
      kind: "activity",
    });
  }
  return out;
}

function nodeId(n: Node): string {
  return n.kind === "track" ? n.track.id : n.visit.id;
}

/**
 * 앞뒤 체류점이 모두 살아 있는 궤적 조각만 남긴다 — 궤적 우선 모드의 뼈대.
 *
 * 파서가 체류 시간의 정점을 잘라내므로 조각은 대개 두 체류점 **사이**에
 * 놓인다. 조각은 앞 점에서 떠나 뒤 점에 닿는 이동이다:
 *
 *   점1 ──조각A── 점2 ──조각B── 점3
 *
 * 점2 를 지우면 점2 로 향한 조각A 도, 점2 에서 떠난 조각B 도 함께 사라진다.
 * 그래야 "서울만 남겼는데 서울↔인천 궤적이 남는다" 가 생기지 않는다.
 * 남은 점1·점3 은 linkNodes 가 호로 잇는다.
 *
 * 주의할 것 둘:
 *
 * - 뒤 이웃은 조각이 **끝난** 뒤의 첫 점이다. 시작 직후의 점으로 잡으면,
 *   체류가 짧아 정점이 하나도 안 떨어져 조각이 관통해 버린 점이 이웃으로
 *   잡히고, 진짜 도착지는 검사에서 빠진다 — 서울 점을 스쳐 제주까지 간
 *   조각이 살아남았던 원인.
 * - 조각이 관통한 점들도 모두 살아 있어야 한다. 그 점을 지웠는데 조각이
 *   그 위를 지나가면 안 된다.
 *
 * 이웃은 **원본 전체**에서 찾는다. 살아남은 점끼리 이웃을 잡으면 지운 점을
 * 건너뛰어 점1~점3 이 한 구간으로 이어지고, 그 사이 조각이 전부 살아남는다.
 * 좌표가 아니라 시간으로 판정하는 이유는 체류점 좌표와 궤적 끝점 좌표가
 * 정확히 일치하는 경우가 31% 뿐이기 때문이다.
 *
 * @param allVisits 원본 체류점 전체 — startMs 오름차순
 * @param alive     화면에 남아 있는 체류점 id
 */
/**
 * 궤적 조각이 잇는 두 체류점의 인덱스 — [떠난 점, 닿은 점].
 *
 * 조각은 두 체류점 **사이**에 놓이므로(파서가 체류 시간의 정점을 잘라낸다)
 * 시간상 조각 앞의 마지막 점이 출발지, 조각이 끝난 뒤의 첫 점이 도착지다.
 * 둘 중 하나라도 없으면(맨 앞·맨 뒤 조각) null.
 *
 * `anchoredTracks`(무엇을 그릴지)와 선 클릭(무엇을 선택할지)이 같은 규칙을
 * 쓰도록 한 곳에 둔다 — 갈라지면 "클릭한 선의 점이 안 잡히는" 일이 생긴다.
 */
export function anchorsOf(
  allVisits: readonly Visit[],
  track: Track,
): [number, number] | null {
  if (allVisits.length < 2) return null;
  const starts = allVisits.map((v) => v.startMs);
  const from = lastBefore(starts, track.startMs);
  const to = lastBefore(starts, track.endMs) + 1;
  if (from < 0 || to >= allVisits.length) return null;
  return [from, to];
}

/** starts[i] < t 인 마지막 i (없으면 -1) */
function lastBefore(starts: readonly number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function anchoredTracks(
  allVisits: readonly Visit[],
  alive: ReadonlySet<string>,
  tracks: readonly Track[],
): Track[] {
  if (allVisits.length < 2) return [];
  const starts = allVisits.map((v) => v.startMs);
  const out: Track[] = [];
  for (const t of tracks) {
    const from = lastBefore(starts, t.startMs); // 떠난 점
    const to = lastBefore(starts, t.endMs) + 1; // 닿은 점 — 끝난 뒤 첫 점
    if (from < 0 || to >= allVisits.length) continue;
    // 떠난 점, 닿은 점, 그 사이를 관통한 점 — 전부 살아 있어야 한다
    let ok = true;
    for (let i = from; i <= to; i++) {
      if (!alive.has(allVisits[i].id)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(t);
  }
  return out;
}

/**
 * 지운 체류점의 시간과 겹치는 **블록**에서 나온 조각의 id.
 *
 * 앞뒤 이웃 판정(anchoredTracks)만으로는 부족하다. 체류가 짧아 그 안에 GPS
 * 정점이 하나도 없으면 파서가 조각을 자르지 못해 조각이 체류를 관통하고,
 * 이웃은 바깥 점으로 잡혀 그 체류를 지워도 조각이 산다.
 *
 * 그래서 사용자 규칙을 그대로 둔다: 지운 점과 시간 교집합이 있는 timelinePath
 * 는 **2시간 블록째** 지운다. 32 분 머문 점을 지워 2 시간치가 사라져도
 * 사용자가 그 자리를 지우겠다고 한 것이므로 의도대로다.
 */
export function tracksInVisits(
  removed: readonly Visit[],
  tracks: readonly Track[],
): Set<string> {
  const out = new Set<string>();
  if (removed.length === 0) return out;
  const spans = removed
    .map((v) => {
      const e = Date.parse(v.end);
      return [v.startMs, Number.isFinite(e) ? e : v.startMs] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  const starts = spans.map((s) => s[0]);
  const MAX_STAY_MS = 14 * 24 * 3600_000;
  for (const t of tracks) {
    const bs = t.blockStartMs ?? t.startMs;
    const be = t.blockEndMs ?? t.endMs;
    // 블록이 끝나기 전에 시작한 체류들만 후보 — 뒤에서부터 훑는다
    let lo = 0;
    let hi = starts.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= be) {
        last = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let i = last; i >= 0; i--) {
      const [s, e] = spans[i];
      if (e >= bs) {
        out.add(t.id);
        break;
      }
      if (bs - s > MAX_STAY_MS) break;
    }
  }
  return out;
}
