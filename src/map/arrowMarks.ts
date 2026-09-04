import type { Track } from "../types";

/**
 * 진행 방향 화살표를 **지오메트리로** 계산한다.
 *
 * 원래는 참조 원본처럼 PathLayer 를 상속해 프래그먼트 셰이더로 다트를
 * 그렸다(ArrowPathLayer). 셰이더 주입·유니폼·어트리뷰트를 오프라인으로
 * 모두 검증했는데도 화면에는 굵어진 선만 나왔다 — 밴드가 균일하게 칠해진
 * 것은 알파 마스크가 전혀 적용되지 않았다는 뜻이다. GPU 안에서 무엇이
 * 어긋났는지는 브라우저 없이 확인할 수 없어, 눈으로 확인 가능한 방식으로
 * 바꿨다: 화살표 위치·각도를 여기서 계산해 레이어에 점으로 넘긴다.
 *
 * 셰이더 방식의 장점(정점 재계산 없음)을 잃지만, 화살표는 편집 모드에서
 * 켤 때만 만들고 개수에 상한이 있어 비용이 제한된다.
 */

export interface ArrowMark {
  /** [lng, lat] */
  position: [number, number];
  /** 회전각(도). 0 이 동쪽(오른쪽), 90 이 북쪽. deck 의 getAngle 규약 */
  angle: number;
}

/** 화살표 사이 간격 — 경로 길이(도) 기준. 화면 픽셀이 아니라 지리 거리다 */
export const ARROW_GAP_DEG = 0.02;

/** 한 조각에 찍을 수 있는 최대 화살표 수 — 긴 궤적이 화면을 덮지 않게 */
const MAX_PER_TRACK = 6;

/** 전체 상한 — 정점 예산과 같은 취지 */
export const ARROW_MAX = 4000;

/**
 * 위도 보정한 두 점 사이 거리(도).
 *
 * 경도 1도는 위도가 높을수록 짧아진다. 보정하지 않으면 동서 이동이
 * 실제보다 길게 잡혀 화살표가 몰린다.
 */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

/**
 * 궤적들 위에 일정 간격으로 화살표를 놓는다.
 *
 * 조각이 간격보다 짧으면 **가운데에 한 개**를 놓는다. 시작 기준으로
 * 간격을 재면 짧은 조각에는 하나도 안 들어간다 — 실측에서 GPS 조각의
 * 절반이 그런 길이였다.
 *
 * @param gapDeg 화살표 간격(도). 줌에 따라 호출부가 조절한다
 */
export function arrowMarks(
  tracks: readonly Track[],
  gapDeg = ARROW_GAP_DEG,
  max = ARROW_MAX,
): ArrowMark[] {
  const out: ArrowMark[] = [];
  for (const t of tracks) {
    if (out.length >= max) break;
    const p = t.path;
    const n = p.length / 2;
    if (n < 2) continue;

    // 정점별 누적 길이
    let total = 0;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      total += dist(p[(i - 1) * 2], p[(i - 1) * 2 + 1], p[i * 2], p[i * 2 + 1]);
      cum[i] = total;
    }
    if (total <= 0) continue;

    // 놓을 위치들 — 가운데를 기준으로 양쪽으로 퍼진다
    const count = Math.min(MAX_PER_TRACK, Math.max(1, Math.floor(total / gapDeg)));
    for (let k = 0; k < count; k++) {
      if (out.length >= max) break;
      // count 개를 균등 배치하되 양끝은 피한다
      const at = (total * (k + 0.5)) / count;
      const mark = pointAt(p, cum, n, at);
      if (mark) out.push(mark);
    }
  }
  return out;
}

/** 누적 길이 `at` 지점의 좌표와 진행 방향 */
function pointAt(
  p: Float64Array,
  cum: Float64Array,
  n: number,
  at: number,
): ArrowMark | null {
  // at 이 속한 구간 찾기 (이분 탐색)
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const segLen = cum[i] - cum[i - 1];
  const f = segLen > 0 ? (at - cum[i - 1]) / segLen : 0;

  const x1 = p[(i - 1) * 2];
  const y1 = p[(i - 1) * 2 + 1];
  const x2 = p[i * 2];
  const y2 = p[i * 2 + 1];
  if (x1 === x2 && y1 === y2) return null;

  // 진행 방향 — 경도차는 위도 보정을 해야 실제 방향이 된다.
  //
  // deck 의 회전 행렬 mat2(cos,-sin, sin,cos) 은 y 가 위로 증가하는
  // 좌표에서 반시계 방향이다. 위도도 위로 증가하므로 atan2(dlat, dlng)
  // 를 그대로 넘기면 된다 — 부호를 뒤집으면 오히려 위아래가 뒤집힌다.
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return { position: [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f], angle };
}
