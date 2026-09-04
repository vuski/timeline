import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import Map, {
  FullscreenControl, GeolocateControl, NavigationControl, ScaleControl, type MapRef,
} from "react-map-gl/maplibre";
import type { Layer } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGLOverlay from "./DeckGLOverlay";
import { BASEMAP_DARK, BASEMAP_LIGHT, INITIAL_VIEW } from "./basemap";
import type { LngLat } from "../data/select";
import { applyMapLabels, applyMapLanguage, preferredLanguage } from "./mapLanguage";
import "./MapView.css";

export interface RectSelect {
  onDone: (a: LngLat, b: LngLat) => void;
  onCancel: () => void;
}

interface Props {
  layers: Layer[];
  dark: boolean;
  rectSelect?: RectSelect;
  onMapReady?: (map: MLMap) => void;
  /** 지도 위의 점·선을 클릭했을 때 — 편집 모드의 선택. 없으면 집히지 않는다 */
  onPick?: (id: string | null, additive: boolean) => void;
  /** 마우스를 올린 대상의 설명 — 없으면 툴팁이 뜨지 않는다 */
  getTooltip?: (o: unknown) => string | null;
  /** 로드 직후 맞출 범위 [[minLng,minLat],[maxLng,maxLat]] — 없으면 기본 시점 */
  fitTo?: [[number, number], [number, number]] | null;
  /**
   * z축 쌓기 강도(0~1). 0 보다 커지면 시야를 기울여 높이가 보이게 한다 —
   * 위에서 수직으로 내려다보는 기본 시점에서는 아무리 쌓아도 평면과 같다.
   */
  zAxis?: number;
  /** 배경지도 지명 표시 — 꾸면 궁적만 남는다 */
  showLabels?: boolean;
}

interface RectPx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 이 픽셀 미만 드래그는 선택이 아니라 클릭으로 본다.
 *
 * 손가락은 마우스보다 흔들리고 접촉면도 넓어, 같은 값을 쓰면 가만히
 * 탭한 것도 사각형 선택으로 잡힌다.
 */
const TINY_DRAG_PX = 4;
const TINY_DRAG_TOUCH_PX = 12;

export default function MapView({
  layers, dark, rectSelect, onMapReady, onPick, getTooltip, fitTo, zAxis = 0,
  showLabels = true,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const fittedRef = useRef(false);
  const [rectPx, setRectPx] = useState<RectPx | null>(null);
  const rectRef = useRef(rectSelect);
  rectRef.current = rectSelect;
  // 스타일이 갈릴 때 콜백이 읽는다 — 최신값이어야 한다
  const labelsRef = useRef(showLabels);
  labelsRef.current = showLabels;
  const active = rectSelect !== undefined;

  // 데이터가 처음 들어오면 그 범위로 맞춘다 — 한국 밖 기록도 화면에 들어와야 한다.
  // 한 번만 한다: 필터를 바꿀 때마다 지도가 튀면 탐색이 불가능하다.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !fitTo || fittedRef.current) return;
    fittedRef.current = true;
    map.fitBounds(fitTo, { padding: 48, duration: 0 });
  }, [fitTo]);

  /**
   * z축을 처음 올릴 때 한 번만 시야를 기울인다. 매번 pitch 를 덮어쓰면
   * 사용자가 나침반으로 맞춘 각도를 빼앗게 되므로, 0 → 양수로 넘어가는
   * 순간에만 개입하고 그 뒤 각도는 사용자에게 맡긴다.
   */
  const pitchedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (zAxis > 0) {
      // 0 → 양수로 넘어가는 순간에만 기울인다. 그 뒤 각도는 사용자 몫이다.
      if (!pitchedRef.current) {
        pitchedRef.current = true;
        if (map.getPitch() < 5) map.easeTo({ pitch: 55, duration: 600 });
      }
      return;
    }
    // 슬라이더가 맨 아래면 **무조건** 평면 시야로 되돌린다.
    //
    // 플래그(pitchedRef)만 보고 판단하면 안 된다. 사용자가 나침반으로 각도를
    // 만지면 플래그와 실제 각도가 어긋나, 0 으로 내려도 복귀 조건이 맞지
    // 않아 55도가 그대로 남는다 — z 는 0 인데 화면은 떠 보인다(실측: z축
    // 좌표가 전부 0 인데 pitch 만 55.0 이었다).
    pitchedRef.current = false;
    // 이미 평면이면 건드리지 않는다 — 첫 렌더(zAxis 0)에서 불필요한 카메라
    // 애니메이션이 나가지 않도록.
    if (map.getPitch() > 0.5) map.easeTo({ pitch: 0, duration: 600 });
  }, [zAxis]);

  /**
   * 지명 표시 — 토글할 때마다, 그리고 스타일이 갈린 뒤에도 다시 반영한다
   * (onStyleData 쪽 참고). 스타일이 아직 안 왔으면 조용히 넘어간다.
   */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    // 스타일이 아직 안 왔으면 넘긴다 — onLoad 가 다시 불러 준다.
    if (!map?.isStyleLoaded?.()) return;
    applyMapLabels(map, showLabels);
  }, [showLabels]);

  // ── 사각 드래그 선택 ──
  // 캡쳐 단계 pointerdown 으로 지도 팬을 선제 차단하고 window 로 직접 추적한다.
  // 사각형은 픽셀 좌표의 DOM 요소 — 재투영이 필요 없으니 deck 레이어로 그릴 이유가 없다.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !active) return;
    const el = map.getCanvasContainer();
    map.dragPan.disable();

    let dragging = false;
    let start: { x: number; y: number } | null = null;
    /** 포인터를 붙잡은 요소 — 떼는 순간 풀어 준다 */
    let captured: number | null = null;

    const release = () => {
      if (captured !== null) {
        try {
          el.releasePointerCapture(captured);
        } catch {
          // 이미 풀렸거나 사라진 포인터 — 상관없다
        }
        captured = null;
      }
    };

    const localXY = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    function onDown(e: PointerEvent) {
      if (dragging || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      dragging = true;
      start = localXY(e);
      setRectPx({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      /*
       * 포인터를 붙잡는다 — 손가락이 캔버스 밖(패널·버튼 위)으로 나가도
       * 이벤트가 계속 이리로 온다. 없으면 가장자리에서 드래그가 끊긴다.
       */
      try {
        el.setPointerCapture(e.pointerId);
        captured = e.pointerId;
      } catch {
        // 캡처를 못 잡아도 window 리스너로 대부분 동작한다
      }
      // 기본 동작(지도 팬·브라우저 스크롤)을 선제로 막는다
      e.preventDefault();
      e.stopPropagation();
    }

    function onMove(e: PointerEvent) {
      if (!dragging || !start) return;
      const p = localXY(e);
      setRectPx({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
      // 터치에서 스크롤로 넘어가지 않게
      e.preventDefault();
    }

    function onUp(e: PointerEvent) {
      if (!dragging || !start) return;
      dragging = false;
      release();
      const from = start;
      start = null;
      const p = localXY(e);
      setRectPx(null);
      // 클릭에 가까운 미세 드래그는 선택이 아니라 취소로 본다
      const slop = e.pointerType === "mouse" ? TINY_DRAG_PX : TINY_DRAG_TOUCH_PX;
      if (Math.abs(p.x - from.x) < slop && Math.abs(p.y - from.y) < slop) {
        rectRef.current?.onCancel();
        return;
      }
      const a = map!.unproject([from.x, from.y]);
      const b = map!.unproject([p.x, p.y]);
      rectRef.current?.onDone({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    }

    /**
     * 브라우저가 제스처를 가로채가면(시스템 백스왜이프, 전화 수신 등)
     * pointerup 이 아니라 pointercancel 이 온다. 그려던 사각형을 치우고
     * 상태를 되돌려야 다음 드래그가 정상적으로 시작된다.
     */
    function onCancel() {
      if (!dragging) return;
      dragging = false;
      release();
      start = null;
      setRectPx(null);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      dragging = false;
      release();
      start = null;
      setRectPx(null);
      rectRef.current?.onCancel();
    }

    el.addEventListener("pointerdown", onDown, true);
    // passive:false — preventDefault 로 브라우저 스크롤을 막아야 하므로
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      map.dragPan.enable();
      setRectPx(null);
    };
  }, [active]);

  return (
    <div className="mapview" data-selecting={String(active)}>
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={dark ? BASEMAP_DARK : BASEMAP_LIGHT}
        // 캡쳐(share/capture.ts)가 캔버스 픽셀을 읽으려면 반드시 켜야 한다 —
        // 끄면 toBlob 이 검은 이미지를 돌려준다. maplibre-gl v5 부터 이 옵션은
        // canvasContextAttributes 안으로 들어갔다.
        canvasContextAttributes={{ preserveDrawingBuffer: true }}
        onLoad={(e) => {
          applyMapLanguage(e.target, preferredLanguage());
          applyMapLabels(e.target, labelsRef.current);
          onMapReady?.(e.target);
        }}
        // 밝은/어두운 스타일을 갈아끼우면 레이어가 새로 오므로 다시 적용한다
        onStyleData={(e) => {
          applyMapLanguage(e.target, preferredLanguage());
          applyMapLabels(e.target, labelsRef.current);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <DeckGLOverlay
          layers={layers}
          getTooltip={
            getTooltip
              ? ({ object }) => {
                  const text = object ? getTooltip(object) : null;
                  // 문자열이 아니라 객체로 돌려주면 deck 이 기본 검정 상자를
                  // 씌운다 — className 만 주고 모양은 CSS 로 잡는다
                  return text ? { text, className: "map-tip" } : null;
                }
              : undefined
          }
          // 빈 곳을 누르면 선택이 풀린다 — 지도에서 벗어날 길이 있어야 한다
          onClick={
            onPick
              ? (info, event) => {
                  const id = (info.object as { id?: string } | null)?.id ?? null;
                  const src = event.srcEvent as MouseEvent | undefined;
                  onPick(id, Boolean(src?.shiftKey || src?.ctrlKey || src?.metaKey));
                }
              : undefined
          }
        />
        {/*
         * 기본 지도 위젯. 나침반까지 켜서 z축을 쌓았을 때 시야를 기울이고
         * 되돌릴 수 있게 한다(끌어서 회전, 클릭으로 북향 복귀).
         */}
        <NavigationControl position="top-left" visualizePitch showCompass />
        <GeolocateControl position="top-left" />
        <FullscreenControl position="top-left" />
        <ScaleControl position="bottom-left" unit="metric" maxWidth={120} />
      </Map>

      {rectPx && (
        <div
          data-testid="rect"
          className="mapview-rect"
          style={{
            left: Math.min(rectPx.x1, rectPx.x2),
            top: Math.min(rectPx.y1, rectPx.y2),
            width: Math.abs(rectPx.x2 - rectPx.x1),
            height: Math.abs(rectPx.y2 - rectPx.y1),
          }}
        />
      )}
    </div>
  );
}
