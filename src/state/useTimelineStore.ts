import { useCallback, useMemo, useState } from "react";
import type { TimelineData, Track, Visit } from "../types";
import { filterByRange, type Range } from "../data/range";
import {
  budgetLimit, countVerts, grade as gradeOf, simplify, type Grade,
} from "../data/budget";
import {
  anchoredTracks, arcTracks, linkNodes, tracksInVisits, type ConnectMode,
} from "../data/connect";
import { applySelection, invertSelection, type SelectMode } from "../data/select";
import { dominantOffset, localOffset } from "../data/timezone";
import { useIsMobile } from "../map/useIsMobile";
import { GLOW_FROM_DEFAULT, GLOW_TO_DEFAULT } from "../map/GlowPathLayer";

export interface GlowStyle {
  /** 굵기 배율 — 기본 10px 밴드에 곱해진다 */
  widthScale: number;
  from: [number, number, number, number];
  to: [number, number, number, number];
}

export const GLOW_STYLE_DEFAULT: GlowStyle = {
  widthScale: 0.6,
  from: GLOW_FROM_DEFAULT,
  to: GLOW_TO_DEFAULT,
};

/**
 * 파생 상태를 한 곳에 모은다.
 *
 * 원본(data)은 절대 수정하지 않는다 — 기간·소스·삭제·선택·솎기를 조합해
 * "지금 보이는 것"을 매번 계산한다. 그래서 되돌리기가 공짜다.
 *
 * 재생의 현재 시각(currentTime)은 **여기 없다** — 매 프레임 리렌더를 막기
 * 위해 ref 로 따로 굴린다 (설계 §6).
 */
export function useTimelineStore(data: TimelineData) {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<Range | null>(null);
  /**
   * 선을 어떻게 만들지 (설계: connect.ts).
   * - path: 실측 궤적 + 빈 구간만 직선으로 메꿈
   * - arc:  궤적 무시, 체류점을 같은 곡률의 호로 이음
   */
  const [connectMode, setConnectMode] = useState<ConnectMode>("path");
  const [simplifyFactor, setSimplifyFactor] = useState(1);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * 기준 시간대(UTC 오프셋 분) — 목록의 날짜 묶기·시각 표시가 이걸 따른다.
   *
   * 기본은 **데이터의 최빈값**이다. 브라우저 시간대로 잡으면 여행 중이거나
   * 브라우저가 다른 시간대일 때 거의 모든 행에 현지 시각이 덧붙어 소음이
   * 된다. 최빈값이면 처음 열었을 때 조용하고, 해외 구간만 눈에 띈다.
   */
  const [baseOffset, setBaseOffset] = useState<number>(
    () => dominantOffset(data.visits) ?? localOffset(),
  );
  const [renderMode, setRenderMode] = useState(false);
  // z축 시간 쌓기 (0~1). 0 이면 납작한 평면 — 기본값 (사용자 지정)
  const [zAxis, setZAxis] = useState(0);
  // 편집 모드에서 진행 방향 화살표를 선 위에 새긴다
  const [showArrows, setShowArrows] = useState(false);
  // 배경지도의 지명 표시. 기본은 켜둠 — 어디인지 알 수 있어야 한다
  const [showLabels, setShowLabels] = useState(true);
  // 체류 집계 — 켜면 점·궁적을 잠시 내리고 타일별 체류시간을 덮는다
  const [tileStay, setTileStay] = useState(false);
  const [glowStyle, setGlowStyle] = useState<GlowStyle>(GLOW_STYLE_DEFAULT);

  // ── 지금 보이는 것 ──
  const visibleVisits = useMemo<Visit[]>(() => {

    const out = filterByRange(data.visits, range).filter((v) => !deletedIds.has(v.id));
    return out;
  }, [data.visits, range, deletedIds]);

  const visibleTracks = useMemo<Track[]>(() => {
    let out: Track[];
    if (connectMode === "arc") {
      // 이동구간 모드 — 원본 궤적을 통째로 무시하고 체류점을 호로 잇는다.
      // 지워진 점은 이미 visibleVisits 에서 빠졌으므로 호도 생기지 않는다.
      out = arcTracks(visibleVisits);
    } else {
      // 궤적 우선 모드 — 실측 조각을 쓰고, 조각·체류점 사이를 호로 잇는다.
      //
      // 두 규칙을 모두 건다:
      //  1. 지운 점과 시간이 겹치는 timelinePath 는 2시간 블록째 지운다
      //  2. 남은 조각 중 앞뒤 체류점이 모두 화면에 있는 것만 그린다
      // 남은 점끼리는 linkNodes 가 호로 잇는다.
      const removed = data.visits.filter((v) => deletedIds.has(v.id));
      const gone = tracksInVisits(removed, data.tracks);
      const alive = new Set(visibleVisits.map((v) => v.id));
      const inRange = filterByRange(data.tracks, range).filter(
        (t) => !deletedIds.has(t.id) && !gone.has(t.id),
      );
      const kept = anchoredTracks(data.visits, alive, inRange);
      out = [...kept, ...linkNodes(kept, visibleVisits)];
    }
    return simplifyFactor > 1 ? out.map((t) => simplify(t, simplifyFactor)) : out;
  }, [data.tracks, data.visits, range, deletedIds, simplifyFactor, connectMode, visibleVisits]);

  // ── 예산 ──
  const limit = budgetLimit(isMobile);
  // 조립까지 끝난 결과를 세므로 모드가 바뀌면 숫자도 따라간다
  const verts = useMemo(
    () => countVerts(visibleTracks, null, 1),
    [visibleTracks],
  );
  const grade: Grade = gradeOf(verts, limit);

  // ── 재생 구간 — 지금 보이는 궤적의 시간 범위 ──
  const span = useMemo(() => {
    if (visibleTracks.length === 0) return { startMs: 0, endMs: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of visibleTracks) {
      if (t.startMs < lo) lo = t.startMs;
      if (t.endMs > hi) hi = t.endMs;
    }
    return { startMs: lo, endMs: hi };
  }, [visibleTracks]);

  // ── 선택 ──
  const select = useCallback((hit: readonly string[], mode: SelectMode) => {
    setSelectedIds((prev) => applySelection(prev, hit, mode));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const invert = useCallback(() => {
    const all = [...visibleVisits.map((v) => v.id), ...visibleTracks.map((t) => t.id)];
    setSelectedIds((prev) => invertSelection(prev, all));
  }, [visibleVisits, visibleTracks]);

  const deleteSelected = useCallback(() => {
    // 선택한 것만 삭제집합에 넣는다. 지운 점에 딸린 궤적은 여기서 계산하지
    // 않는다 — visibleTracks 가 "지운 점의 시간에 걸친 조각" 을 매번 빼고
    // 남은 것만 잇기 때문에, 판정을 두 곳에 두면 어긋날 뿐이다.
    //
    // 연결선(link-/arc- 접두)은 파생물이라 id 를 지워도 다음 렌더에 다시
    // 생긴다 — 대신 재료가 되는 점·조각이 사라지므로 함께 사라진다.
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedIds) next.add(id);
      return next;
    });
    // 사라진 것을 선택한 채로 두지 않는다
    setSelectedIds(new Set());
  }, [selectedIds]);

  /**
   * 선택만 남긴다 — 선택되지 않은 것을 삭제집합에 넣는 1회성 동작.
   * 별도 상태를 두지 않고 deletedIds 로 표현하므로 "삭제 되돌리기" 가
   * 그대로 동작하고, 이후 다른 필터와도 자연히 합쳐진다.
   */
  const keepOnlySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    // **점만** 지운다. 궤적은 살아남은 점에서 도출되므로(anchoredTracks)
    // 여기서 따로 지울 필요가 없다.
    //
    // 궤적까지 지우면 안 되는 이유: 영역 선택은 점만 집는다(Workspace).
    // 그래서 selectedIds 에 궤적 id 가 하나도 없고, "선택 안 된 것" 조건에
    // 모든 궤적이 걸려 통째로 사라졌다.
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const v of visibleVisits) if (!selectedIds.has(v.id)) next.add(v.id);
      return next;
    });
    setSelectedIds(new Set());
  }, [selectedIds, visibleVisits]);

  /** 지금 지워진 것 중 궤적·구간이 몇 개인지 — 되돌리기 안내에 쓴다 */
  const deletedCount = deletedIds.size;

  const restoreDeleted = useCallback(() => setDeletedIds(new Set()), []);

  return {
    data,
    isMobile,
    range, setRange,
    connectMode, setConnectMode,
    simplifyFactor, setSimplifyFactor,
    deletedIds, deletedCount, selectedIds,
    select, clearSelection, invert, deleteSelected, keepOnlySelected, restoreDeleted,
    baseOffset, setBaseOffset,
    renderMode, setRenderMode,
    zAxis, setZAxis,
    showArrows, setShowArrows,
    showLabels, setShowLabels,
    tileStay, setTileStay,
    glowStyle, setGlowStyle,
    visibleVisits, visibleTracks,
    verts, grade, limit, span,
  };
}

export type TimelineStore = ReturnType<typeof useTimelineStore>;
