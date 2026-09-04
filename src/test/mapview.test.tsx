import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BASEMAP_DARK, BASEMAP_LIGHT } from "../map/basemap";

// jsdom 에 WebGL 이 없다 — 지도를 통째로 모킹하고 우리가 책임지는 부분
// (프롭 계약·사각 선택 기하)만 검증한다.
const mapMock = {
  props: {} as Record<string, unknown>,
  instance: {
    getCanvasContainer: () => document.getElementById("canvas-container")!,
    unproject: ([x, y]: [number, number]) => ({ lat: 37 + y / 100, lng: 127 + x / 100 }),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    fitBounds: vi.fn(),
    // 실제 지도처럼 easeTo 가 각도를 바꾼다 — 고정 0 이면 "기울었다가
    // 되돌아오는" 흐름을 흉내낼 수 없어 복귀 로직을 검증하지 못한다
    pitch: 0,
    getPitch(): number {
      return mapMock.instance.pitch;
    },
    easeTo: vi.fn((o: { pitch?: number }) => {
      if (typeof o?.pitch === "number") mapMock.instance.pitch = o.pitch;
    }),
  },
};

vi.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mapMock.props = props;
    const ref = props.ref as { current: unknown } | undefined;
    if (ref) ref.current = { getMap: () => mapMock.instance };
    return (
      <div data-testid="map">
        <div id="canvas-container" />
        {props.children as React.ReactNode}
      </div>
    );
  },
  useControl: () => ({ setProps: vi.fn() }),
  NavigationControl: () => null,
  GeolocateControl: () => null,
  FullscreenControl: () => null,
  ScaleControl: () => null,
}));

vi.mock("../map/DeckGLOverlay", () => ({ default: () => null }));

const { default: MapView } = await import("../map/MapView");

/** ref 를 채우려면 함수 컴포넌트 목에 ref 를 직접 넘겨야 한다 */
function renderMap(props: Record<string, unknown> = {}) {
  const ref = { current: null as unknown };
  mapMock.props = {};
  const r = render(<MapView layers={[]} dark={false} {...props} />);
  return { ...r, ref };
}

describe("베이스맵", () => {
  it("탐색용과 시각화용 두 스타일을 키 없이 쓴다 (Carto)", () => {
    expect(BASEMAP_LIGHT).toContain("basemaps.cartocdn.com");
    expect(BASEMAP_DARK).toContain("basemaps.cartocdn.com");
    expect(BASEMAP_LIGHT).not.toBe(BASEMAP_DARK);
  });
});

describe("MapView", () => {
  it("캡쳐를 위해 preserveDrawingBuffer 를 켠다", () => {
    renderMap();
    // 이 옵션이 없으면 toBlob 이 검은 이미지를 돌려준다
    expect((mapMock.props.canvasContextAttributes as { preserveDrawingBuffer?: boolean }).preserveDrawingBuffer).toBe(true);
  });

  it("탐색 모드는 밝은 스타일, 시각화 모드는 어두운 스타일", () => {
    renderMap();
    expect(mapMock.props.mapStyle).toBe(BASEMAP_LIGHT);
    renderMap({ dark: true });
    expect(mapMock.props.mapStyle).toBe(BASEMAP_DARK);
  });

  it("사각 선택 중이 아니면 드래그해도 사각형이 생기지 않는다", () => {
    renderMap();
    const el = document.getElementById("canvas-container")!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, isPrimary: true, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 40 });
    expect(screen.queryByTestId("rect")).toBeNull();
  });

  it("사각 선택 중에는 드래그 사각형을 그린다", () => {
    renderMap({ rectSelect: { onDone: vi.fn(), onCancel: vi.fn() } });
    const el = document.getElementById("canvas-container")!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, isPrimary: true, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 40 });
    expect(screen.getByTestId("rect")).toBeInTheDocument();
  });

  it("드래그를 놓으면 두 모서리를 좌표로 돌려준다", () => {
    const onDone = vi.fn();
    renderMap({ rectSelect: { onDone, onCancel: vi.fn() } });
    const el = document.getElementById("canvas-container")!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, isPrimary: true, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 40 });
    expect(onDone).toHaveBeenCalledTimes(1);
    const [a, b] = onDone.mock.calls[0];
    expect(a.lat).toBeCloseTo(37.1);
    expect(b.lat).toBeCloseTo(37.4);
    expect(screen.queryByTestId("rect")).toBeNull();
  });

  it("클릭에 가까운 미세 드래그는 선택이 아니라 취소로 본다", () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    renderMap({ rectSelect: { onDone, onCancel } });
    const el = document.getElementById("canvas-container")!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, isPrimary: true, button: 0 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 11 });
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("사각 선택 중에는 지도 팬을 막는다 (드래그가 지도를 끌면 선택이 불가능하다)", () => {
    mapMock.instance.dragPan.disable.mockClear();
    renderMap({ rectSelect: { onDone: vi.fn(), onCancel: vi.fn() } });
    expect(mapMock.instance.dragPan.disable).toHaveBeenCalled();
  });

  it("z축을 올리면 시야를 기울인다 (위에서 내려다보면 높이가 안 보인다)", () => {
    mapMock.instance.easeTo.mockClear();
    const { rerender } = render(<MapView layers={[]} dark={false} zAxis={0} />);
    expect(mapMock.instance.easeTo).not.toHaveBeenCalled();
    rerender(<MapView layers={[]} dark={false} zAxis={0.5} />);
    expect(mapMock.instance.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 55 }),
    );
  });

  it("z축을 0 으로 되돌리면 시야도 평면으로 돌아온다", () => {
    mapMock.instance.easeTo.mockClear();
    const { rerender } = render(<MapView layers={[]} dark={false} zAxis={0.5} />);
    mapMock.instance.easeTo.mockClear();
    rerender(<MapView layers={[]} dark={false} zAxis={0} />);
    expect(mapMock.instance.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 0 }),
    );
  });

  it("데이터 범위로 한 번만 맞춘다 (필터마다 지도가 튀면 안 된다)", () => {
    mapMock.instance.fitBounds.mockClear();
    const bounds: [[number, number], [number, number]] = [[126, 36], [128, 38]];
    const { rerender } = render(<MapView layers={[]} dark={false} fitTo={bounds} />);
    rerender(<MapView layers={[]} dark={false} fitTo={bounds} />);
    expect(mapMock.instance.fitBounds).toHaveBeenCalledTimes(1);
  });
});
