import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import type { DeckProps } from "@deck.gl/core";

interface Props extends DeckProps {
  /** 오버레이 인스턴스가 필요할 때(예: pointerdown 선제 픽 판정) 받아간다 */
  onOverlayReady?: (overlay: MapboxOverlay) => void;
}

/**
 * deck.gl 레이어를 지도 위에 올린다.
 *
 * `interleaved: true` — deck 이 **지도와 같은 WebGL 캔버스**에 그린다.
 * 기본값(false)이면 deck 이 자기 캔버스를 따로 만들어 지도 위에 겹치는데,
 * 그러면 캔버스 하나만 읽는 캡쳐·녹화(share/)에 궤적이 담기지 않는다 —
 * 배경지도만 찍힌다. 같은 캔버스에 그려야 한 장으로 읽힌다.
 */
export default function DeckGLOverlay({ onOverlayReady, ...props }: Props) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ ...props, interleaved: true }),
  );
  overlay.setProps(props);
  onOverlayReady?.(overlay);
  return null;
}
