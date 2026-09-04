import { describe, expect, it } from "vitest";
import { buildLayers, type LayerInput } from "../map/layers";
import { GLOW_STYLE_DEFAULT } from "../state/useTimelineStore";
import type { Track, Visit } from "../types";

const visit: Visit = {
  id: "v0", lat: 37, lng: 127, start: "2015-06-01T10:00:00.000+09:00",
  end: "2015-06-01T11:00:00.000+09:00", startMs: 0, placeId: null, semanticType: null,
};

const track: Track = {
  id: "t0",
  path: Float64Array.from([127, 37, 127.1, 37.1]),
  times: Float64Array.from([1000, 3000]),
  startMs: 1000, endMs: 3000,
  start: "2015-06-01T10:00:00.000+09:00", kind: "path",
};

const base: LayerInput = {
  visits: [visit], tracks: [track],
  renderMode: false, glowStyle: GLOW_STYLE_DEFAULT,
  selectedIds: new Set(),
  timeFiltered: false, currentTime: 2000, trailDuration: 500, timeOrigin: 1000,
  zMetersPerSecond: 0, showArrows: false,
};

const idsOf = (i: LayerInput) => buildLayers(i).map((l) => l.id);

describe("buildLayers", () => {
  it("탐색 모드에서는 체류점과 경로를 함께 그린다", () => {
    const ids = idsOf(base);
    expect(ids).toContain("paths");
    expect(ids).toContain("visits");
  });

  it("시각화 모드에서는 발광 궤적만 그린다 (점 없이 선만)", () => {
    const ids = idsOf({ ...base, renderMode: true });
    expect(ids).toContain("glow");
    expect(ids).not.toContain("visits");
    expect(ids).not.toContain("paths");
  });

  it("재생 중에는 시간 필터 레이어로 갈아탄다", () => {
    const ids = idsOf({ ...base, renderMode: true, timeFiltered: true });
    expect(ids).toContain("glow-trips");
    expect(ids).not.toContain("glow");
  });

  it("재생이 아니면 시간 필터 레이어를 쓰지 않는다 (전체가 보여야 한다)", () => {
    expect(idsOf({ ...base, renderMode: true, timeFiltered: false })).not.toContain("glow-trips");
  });

  it("데이터가 없으면 레이어도 없다", () => {
    expect(buildLayers({ ...base, visits: [], tracks: [] })).toHaveLength(0);
  });

  it("발광 레이어는 additive 블렌딩을 켠다 (겹치면 밝게 쌓인다)", () => {
    const glow = buildLayers({ ...base, renderMode: true }).find((l) => l.id === "glow")!;
    const params = (glow.props as unknown as { parameters: { blend: boolean; blendColorDstFactor: string } })
      .parameters;
    expect(params.blend).toBe(true);
    expect(params.blendColorDstFactor).toBe("one");
  });

  it("재생 레이어는 정점별 시각을 z 로 실어 보낸다", () => {
    // z 인코딩이 빠지면(= d.path 를 그대로 넘기면) stride 2 라 이 검사가 깨진다
    const layer = buildLayers({ ...base, renderMode: true, timeFiltered: true, zMetersPerSecond: 100 })
      .find((l) => l.id === "glow-trips")!;
    const getPath = (layer.props as unknown as { getPath: (d: Track) => Float64Array }).getPath;
    const out = getPath(track);
    expect(out).toHaveLength(6); // 정점 2개 × [lng,lat,고도]
    // 시각 1000·3000ms, timeOrigin 1000 → 상대 0·2초 → 고도 0·200m
    expect(Array.from(out)).toEqual([127, 37, 0, 127.1, 37.1, 200]);
  });

  it("납작 모드에서도 재생 레이어의 z 는 극소 고도라 화면 밖으로 안 나간다", () => {
    const layer = buildLayers({ ...base, renderMode: true, timeFiltered: true })
      .find((l) => l.id === "glow-trips")!;
    const getPath = (layer.props as unknown as { getPath: (d: Track) => Float64Array }).getPath;
    const out = getPath(track);
    expect(out[5]).toBeGreaterThan(0); // 시간 정보는 살아 있다
    expect(out[5]).toBeLessThan(0.001); // 미터 — 평면
  });

  it("재생 레이어는 positionFormat 을 XYZ 로 쓴다 (z 를 읽으려면 필수)", () => {
    const layer = buildLayers({ ...base, renderMode: true, timeFiltered: true })
      .find((l) => l.id === "glow-trips")!;
    expect((layer.props as unknown as { positionFormat: string }).positionFormat).toBe("XYZ");
  });

  it("탐색 모드 경로는 좌표를 복사하지 않고 그대로 넘긴다", () => {
    const layer = buildLayers(base).find((l) => l.id === "paths")!;
    const getPath = (layer.props as unknown as { getPath: (d: Track) => unknown }).getPath;
    expect(getPath(track)).toBe(track.path);
  });

  it("선택된 점은 다른 색으로 그린다", () => {
    const pick = (i: LayerInput) => {
      const l = buildLayers(i).find((x) => x.id === "visits")!;
      return (l.props as unknown as { getFillColor: (v: Visit) => number[] }).getFillColor(visit);
    };
    expect(pick({ ...base, selectedIds: new Set(["v0"]) })).not.toEqual(pick(base));
  });

  it("z축 배율이 0 이면 정지 상태 궤적은 납작한 XY 로 그린다", () => {
    const layer = buildLayers({ ...base, renderMode: true }).find((l) => l.id === "glow")!;
    expect((layer.props as unknown as { positionFormat: string }).positionFormat).toBe("XY");
  });

  it("z축 배율을 올리면 정지 상태에서도 z 를 쌓는다", () => {
    const layer = buildLayers({ ...base, renderMode: true, zMetersPerSecond: 100 })
      .find((l) => l.id === "glow")!;
    const props = layer.props as unknown as {
      positionFormat: string;
      getPath: (d: Track) => Float64Array;
    };
    expect(props.positionFormat).toBe("XYZ");
    // 정점 시각 1000·3000ms, timeOrigin 1000 → 상대 0·2초 → 고도 0·200m
    expect(Array.from(props.getPath(track))).toEqual([127, 37, 0, 127.1, 37.1, 200]);
  });

  it("z축을 0 으로 내리면 좌표를 다시 읽는다 — 납작 분기에도 getPath 트리거가 있어야", () => {
    // deck.gl 은 새 props 의 트리거만 검사하고, PathLayer 는 getPath 트리거가
    // 바뀔 때만 좌표를 다시 읽는다. 납작 분기에 이 키가 없으면 쌓기 → 납작
    // 전환에서 이전 XYZ 좌표가 남아 궤적이 떠 있다(실측: 슬라이더 0 인데 떠 보임).
    const trig = (z: number) => {
      const l = buildLayers({ ...base, renderMode: true, zMetersPerSecond: z })
        .find((x) => x.id === "glow")!;
      return (l.props as unknown as { updateTriggers: { getPath?: unknown } }).updateTriggers.getPath;
    };
    expect(trig(0)).toBeDefined();
    expect(trig(0)).not.toEqual(trig(100));
  });

  it("방향 표시를 켜면 화살표 레이어로 바꾼다 — id 가 일반 선과 달라야 한다", () => {
    const on = buildLayers({ ...base, showArrows: true });
    const arrow = on.find((l) => l.constructor.name.includes("Arrow"))!;
    expect(arrow).toBeDefined();
    // deck.gl 은 id 만으로 레이어를 이어 붙인다. "paths" 를 같이 쓰면 일반
    // 선의 컴파일된 셰이더를 물려받아 화살표가 절대 그려지지 않는다.
    expect(arrow.id).not.toBe("paths");
    expect(on.some((l) => l.id === "paths")).toBe(false);
  });

  it("이동 궤적과 이동 구간을 다른 색으로 구분한다", () => {
    const layer = buildLayers(base).find((l) => l.id === "paths")!;
    const getColor = (layer.props as unknown as { getColor: (d: Track) => number[] }).getColor;
    expect(getColor(track)).not.toEqual(getColor({ ...track, kind: "activity" }));
  });
});
