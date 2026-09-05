import type { TimelineData, Track, Visit } from "../types";

/**
 * "37.5205413°, 126.8820833°" → [lat, lng]
 *
 * 도 기호는 인코딩이 깨져 오는 경우가 실제로 있다(표본에서 확인). 숫자만
 * 집어내는 정규식이라 기호가 무엇이든, 없어도 읽힌다.
 */
export function parseLatLng(s: unknown): [number, number] | null {
  if (typeof s !== "string") return null;
  const m = s.match(/(-?\d+(?:\.\d+)?)[^,\d-]*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/** 진행률 보고 간격 — 세그먼트 개수 */
const PROGRESS_EVERY = 2000;

type Seg = Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 구글 지도 타임라인 JSON 을 파싱한다.
 *
 * 두 종류를 취한다 (설계 §2):
 * - visit        → 체류점
 * - timelinePath → 실측 GPS 궤적 (정점마다 시각)
 *
 * `activity` 는 버린다. 같은 이동을 궤적이 GPS 로 기록하는데 activity 는
 * 출발·도착 좌표 두 개뿐이라, 실측이 있으면 쓸 이유가 없다. 실측 표본에서
 * 시간대의 51% 가 궤적과 겹쳐 같은 여정이 두 번 그려지기도 했다.
 * 궤적이 없는 시간은 체류점을 호로 이어 메꾼다(connect.ts).
 *
 * ── 체류 시간의 정점은 잘라낸다 ──
 *
 * 궤적은 2시간 고정 블록이다(실측 21,569 개 전부 정확히 120 분). 머문
 * 시간도 이 블록에 그대로 담기므로, 손대지 않으면 한자리에서 흔들린 GPS
 * 점이 체류점 위에 뭉친다. 그래서 체류 시간에 들어가는 정점을 빼고, 남은
 * 조각만 실측 궤적으로 삼는다 — 블록은 그 자리에서 여러 조각으로 갈린다.
 * 실측 결과 정점 161,632 → 92,892 (40.8% 가 체류 중 흔들림이었다).
 *
 * 잘린 자리는 체류점과 호로 이어진다(connect.ts). 블록을 통째로 버리는
 * 방법도 있었지만, 32 분 체류가 2 시간 블록을 무효로 만들어 궤적의 98% 가
 * 사라졌다 — 사람은 대부분의 시간을 어딘가에 머물러 있기 때문이다.
 *
 * 좌표·시각이 깨진 세그먼트는 조용히 건너뛴다. 12년치 6만 세그먼트에서
 * 몇 건이 깨졌다고 전체 가져오기가 실패하면 안 된다.
 */
export function parseTimeline(
  text: string,
  onProgress?: (pct: number) => void,
): TimelineData {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("invalid-json");
  }
  const segs = asRecord(root)?.semanticSegments;
  if (!Array.isArray(segs)) throw new Error("not-timeline");

  const visits: Visit[] = [];
  const tracks: Track[] = [];
  /**
   * 궤적 원석 — 체류 시간을 알아야 자를 수 있어 2 단계로 나눈다.
   * 1 단계에서 좌표·시각만 모아 두고, 체류가 다 모인 뒤 잘라낸다.
   */
  const rawPaths: Array<{
    coords: number[]; times: number[]; start: string; blockStartMs: number; blockEndMs: number;
  }> = [];
  const vertsByYear: Record<string, number> = {};
  // 전체 기간(span)은 좌표 파싱 성공 여부와 무관하게, visit/timelinePath/
  // activity 중 하나를 가진 유효한 세그먼트라면 모두 반영한다 — 실제 있었던
  // 일(체류/이동)의 날짜이기 때문. 좌표가 깨져서 지도에 못 그린다고 그 날의
  // 기록 자체가 없었던 것은 아니다.
  const days: string[] = [];
  /*
   * 이동 구간 — activity 세그먼트의 시각만. 좌표는 담지 않는다.
   * 그리기에는 쓰이지 않고 "얼마나 이동 중이었나" 를 세는 데만 쓴다.
   */
  const moveSpans: Array<[number, number]> = [];

  const list = segs as Seg[];
  for (let i = 0; i < list.length; i++) {
    if (onProgress && i % PROGRESS_EVERY === 0) {
      onProgress(Math.round((i / list.length) * 100));
    }
    const seg = asRecord(list[i]);
    if (!seg) continue;
    const segStart = str(seg.startTime);
    const segEnd = str(seg.endTime);
    if (!segStart || !segEnd) continue;

    // ── visit ──
    const visit = asRecord(seg.visit);
    if (visit) {
      days.push(segStart.slice(0, 10));
      const tc = asRecord(visit.topCandidate);
      const ll = parseLatLng(asRecord(tc?.placeLocation)?.latLng);
      if (ll) {
        visits.push({
          id: "",
          lat: ll[0],
          lng: ll[1],
          start: segStart,
          end: segEnd,
          startMs: Date.parse(segStart),
          offsetMin: num(seg.startTimeTimezoneUtcOffsetMinutes),
          placeId: str(tc?.placeId),
          semanticType: str(tc?.semanticType),
        });
      }
      continue;
    }

    // ── timelinePath ──
    const tp = seg.timelinePath;
    if (Array.isArray(tp)) {
      days.push(segStart.slice(0, 10));
      const coords: number[] = [];
      const times: number[] = [];
      for (const raw of tp) {
        const pt = asRecord(raw);
        const ll = parseLatLng(pt?.point);
        if (!ll) continue;
        const time = str(pt?.time) ?? segStart;
        const ms = Date.parse(time);
        if (!Number.isFinite(ms)) continue;
        coords.push(ll[1], ll[0]); // deck.gl 은 [lng, lat]
        times.push(ms);
      }
      // 정점이 하나뿐이면 선이 되지 않는다 — 버린다
      if (times.length >= 2) {
        rawPaths.push({
          coords, times, start: segStart,
          blockStartMs: Date.parse(segStart), blockEndMs: Date.parse(segEnd),
        });
      }
      continue;
    }

    // ── activity ──
    /*
     * 좌표는 쓰지 않는다(위 주석 참고). 다만 그날 무언가 있었다는 사실은
     * 전체 기간 계산에 반영한다.
     *
     * 시간 구간은 따로 모은다. 그리는 데는 쓰지 않지만, "언제 이동
     * 중이었나" 를 세려면 이것이라야 한다 — 실측 파일에서 timelinePath
     * 만으로 세면 이동 325일·기록없음 255일이 나오는데, activity 까지
     * 넣으면 507일·73일이다. 버려 둔 182일이 이동이 아니라 "기록 없음"
     * 으로 잘못 분류되고 있었다.
     */
    if (asRecord(seg.activity)) {
      days.push(segStart.slice(0, 10));
      const a = Date.parse(segStart);
      const b = Date.parse(segEnd);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) moveSpans.push([a, b]);
    }
  }

  // ── 체류 시간에 걸린 정점을 잘라낸다 ──
  visits.sort((x, y) => x.start.localeCompare(y.start));
  const stays = visitRanges(visits);
  for (const raw of rawPaths) {
    for (const piece of clipToPieces(raw.coords, raw.times, stays)) {
      const t = makeTrack(piece.coords, piece.times, raw.start, "path");
      t.blockStartMs = raw.blockStartMs;
      t.blockEndMs = raw.blockEndMs;
      tracks.push(t);
    }
  }

  tracks.sort((x, y) => x.startMs - y.startMs);

  // 조각에 시간대를 물려준다 — timelinePath 에는 오프셋이 없다(실측 21,569
  // 개 전부). 조각은 두 체류점 사이에 놓이므로 출발지 점의 값을 쓴다.
  {
    const vs = visits.map((v) => v.startMs);
    for (const t of tracks) {
      // t.startMs 직전에 시작한 체류점 = 출발지
      let lo = 0;
      let hi = vs.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (vs[mid] <= t.startMs) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      t.offsetMin = at >= 0 ? visits[at].offsetMin : null;
    }
  }

  visits.forEach((v, i) => (v.id = `v${i}`));
  tracks.forEach((t, i) => (t.id = `t${i}`));

  let totalVerts = 0;
  for (const t of tracks) {
    const n = t.path.length / 2;
    totalVerts += n;
    const year = t.start.slice(0, 4);
    vertsByYear[year] = (vertsByYear[year] ?? 0) + n;
  }

  days.sort();

  onProgress?.(100);

  return {
    visits,
    tracks,
    spanFrom: days[0] ?? "",
    spanTo: days.at(-1) ?? "",
    totalVerts,
    vertsByYear,
    // 시작 시각 오름차순 — 세는 쪽에서 정렬을 다시 하지 않게
    moveSpans: moveSpans.sort((x, y) => x[0] - y[0]),
  };
}

/** 체류 구간 [시작ms, 끝ms] — 시작 시각 오름차순 */
export type StayRange = readonly [number, number];

/**
 * 체류점을 시간 구간 목록으로. 정렬해 두면 이분 탐색으로 볼 수 있다 —
 * 정점 16만 × 체류 1.8만을 이중 루프로 돌면 29억 번 비교다.
 */
export function visitRanges(visits: readonly Visit[]): StayRange[] {
  const out: StayRange[] = [];
  for (const v of visits) {
    const e = Date.parse(v.end);
    if (Number.isFinite(v.startMs) && Number.isFinite(e) && e >= v.startMs) {
      out.push([v.startMs, e]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/** 체류가 가장 길어야 이 정도 — 이분 탐색을 어디서 멈출지의 기준 */
const MAX_STAY_MS = 14 * 24 * 3600_000;

/** 이 시각이 어느 체류 안에 들어가는가 */
function inAnyStay(t: number, stays: readonly StayRange[]): boolean {
  // stays[i][0] <= t 인 마지막 i 를 찾고, 거기서부터 뒤로 훑는다
  let lo = 0;
  let hi = stays.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (stays[mid][0] <= t) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = last; i >= 0; i--) {
    const [s, e] = stays[i];
    if (t <= e) return true;
    // 이보다 앞선 체류는 더 일찍 시작했다 — 가장 긴 체류보다 멀어지면 멈춘다
    if (t - s > MAX_STAY_MS) break;
  }
  return false;
}

/** 잘라낸 궤적 조각 */
export interface PathPiece {
  coords: number[];
  times: number[];
}

/**
 * 체류 시간에 들어가는 정점을 빼고, 남은 것을 이어진 조각으로 나눈다.
 *
 * 한자리에 머무는 동안에도 GPS 는 계속 흔들린 점을 남긴다. 그대로 두면
 * 체류점 위에 실뭉치가 얹힌다. 그 구간을 들어내면 궤적이 "이동한 부분"
 * 만 남고, 빈자리는 체류점과 호로 이어진다(connect.ts).
 *
 * 정점 1 개짜리 조각은 선이 되지 않으므로 버린다.
 */
export function clipToPieces(
  coords: readonly number[],
  times: readonly number[],
  stays: readonly StayRange[],
): PathPiece[] {
  const out: PathPiece[] = [];
  let cur: PathPiece | null = null;
  for (let i = 0; i < times.length; i++) {
    if (inAnyStay(times[i], stays)) {
      if (cur && cur.times.length >= 2) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { coords: [], times: [] };
    cur.coords.push(coords[i * 2], coords[i * 2 + 1]);
    cur.times.push(times[i]);
  }
  if (cur && cur.times.length >= 2) out.push(cur);
  return out;
}

function makeTrack(
  coords: number[],
  times: number[],
  start: string,
  kind: Track["kind"],
): Track {
  return {
    id: "",
    path: Float64Array.from(coords),
    times: Float64Array.from(times),
    startMs: times[0],
    endMs: times[times.length - 1],
    start,
    kind,
  };
}
