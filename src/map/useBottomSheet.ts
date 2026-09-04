import { useCallback, useEffect, useRef, useState } from "react";

/** 시트 높이 단계 — 화면 높이 대비 비율 */
export const SHEET_SNAPS = {
  collapsed: 0.12, // 손잡이 + 살짝
  half: 0.45,
  full: 0.9,
} as const;

export type SheetSnap = keyof typeof SHEET_SNAPS;
const ORDER: SheetSnap[] = ["collapsed", "half", "full"];

/** 이 속도(px/ms)를 넘겨 튕기면 거리와 무관하게 방향대로 한 단계 이동 */
const FLING_VELOCITY = 0.5;

interface Options {
  initial?: SheetSnap;
}

/**
 * 모바일 바텀시트 드래그 제어.
 * 손잡이를 끌면 시트가 손가락을 따라오고, 놓으면 가장 가까운 단계로 스냅한다.
 * 빠르게 튕기면(fling) 거리와 무관하게 그 방향으로 한 단계 이동한다.
 */
export function useBottomSheet({ initial = "half" }: Options = {}) {
  const [snap, setSnap] = useState<SheetSnap>(initial);
  /** 드래그 중 실시간 높이(px). null 이면 스냅 상태(CSS 전환 사용) */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const startTime = useRef(0);
  const dragging = useRef(false);

  const viewportH = () => (typeof window === "undefined" ? 800 : window.innerHeight);
  const heightFor = useCallback((s: SheetSnap) => SHEET_SNAPS[s] * viewportH(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      startY.current = e.clientY;
      startHeight.current = heightFor(snap);
      startTime.current = e.timeStamp;
      setDragHeight(startHeight.current);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [heightFor, snap],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // 아래로 끌면(clientY 증가) 시트가 낮아진다
    const delta = startY.current - e.clientY;
    const max = viewportH() * SHEET_SNAPS.full;
    const next = Math.min(Math.max(startHeight.current + delta, 0), max);
    setDragHeight(next);
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      const dy = startY.current - e.clientY; // 위로 끌면 양수
      const dt = Math.max(e.timeStamp - startTime.current, 1);
      const velocity = dy / dt;
      const idx = ORDER.indexOf(snap);

      let target: SheetSnap;
      if (Math.abs(velocity) > FLING_VELOCITY) {
        // 튕김 — 방향대로 한 단계
        target = ORDER[Math.min(Math.max(idx + (velocity > 0 ? 1 : -1), 0), ORDER.length - 1)];
      } else {
        // 놓은 높이에서 가장 가까운 단계로
        const h = dragHeight ?? heightFor(snap);
        const ratio = h / viewportH();
        target = ORDER.reduce((best, s) =>
          Math.abs(SHEET_SNAPS[s] - ratio) < Math.abs(SHEET_SNAPS[best] - ratio) ? s : best,
        ORDER[0]);
      }
      setSnap(target);
      setDragHeight(null);
    },
    [dragHeight, heightFor, snap],
  );

  // 화면 회전·리사이즈 중 드래그가 남아 있으면 정리
  useEffect(() => {
    function onResize() {
      if (dragging.current) {
        dragging.current = false;
        setDragHeight(null);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const expand = useCallback(() => setSnap("half"), []);

  return {
    snap,
    setSnap,
    expand,
    dragHeight,
    dragging: dragging.current,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
