import type { Layer } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import ArrowPathLayer from "./ArrowPathLayer";
import GlowPathLayer, { GLOW_PARAMETERS } from "./GlowPathLayer";
import GlowTripsLayer from "./GlowTripsLayer";
import type { Track, Visit } from "../types";
import type { GlowStyle } from "../state/useTimelineStore";

export const VISIT_COLOR: [number, number, number, number] = [71, 107, 191, 230];
export const SELECTED_COLOR: [number, number, number, number] = [252, 186, 3, 255];
export const PATH_COLOR: [number, number, number, number] = [120, 160, 200, 140];
export const ACTIVITY_COLOR: [number, number, number, number] = [120, 160, 200, 70];

export interface LayerInput {
  visits: Visit[];
  tracks: Track[];
  /** 어두운 지도 + 발광 궤적 모드 */
  renderMode: boolean;
  glowStyle: GlowStyle;
  selectedIds: ReadonlySet<string>;
  /**
   * 시간 필터(꼬리)를 적용하는가. 자동·수동 재생 모두 true —
   * 수동에서도 꼬리가 보여야 드래그로 시점을 찾을 수 있다.
   */
  timeFiltered: boolean;
  currentTime: number;
  trailDuration: number;
  timeOrigin: number;
  /** z 에 실을 고도 배율 (상대 초 1 당 미터). 0 이면 납작한 평면 */
  zMetersPerSecond: number;
  /** 편집 모드에서 진행 방향 화살표를 선 위에 새긴다 */
  showArrows: boolean;
  /**
   * 체류 집계를 보는 중인가.
   *
   * 격자 자체는 SVG 가 그린다(map/TileOverlay) — 칸이 몇 개뿐이라
   * 브라우저가 직접 글자를 그리는 편이 선명하고, 아틀라스에 얽힌
   * 굵기·합자 문제도 없다. 여기서는 그동안 점과 궤적을 숨기는 것만 맡는다.
   */
  tilesOn?: boolean;
}

/**
 * 지도에 날짜를 찍을 최대 개수.
 *
 * 12년치를 전부 찍으면 화면이 글자로 덮여 아무것도 읽을 수 없다. 선택한
 * 것만, 그중에서도 최근 날짜부터 이만큼만 찍는다. 넘으면 UI 가 안내한다.
 */
export const LABEL_MAX = 10;

/** 라벨 텍스트: 체류점은 날짜+시각, 궤적은 날짜 */
function labelFor(start: string, withTime: boolean): string {
  return withTime ? `${start.slice(0, 10)} ${start.slice(11, 16)}` : start.slice(0, 10);
}

/**
 * 선택한 것 중 지도에 날짜를 찍을 것들 — 최근 날짜 순으로 LABEL_MAX 개.
 *
 * 레이어 밖으로 뺀 이유: "몇 개가 잘렸는지" 를 UI 도 알아야 안내를 띄운다.
 */
export function labelTargets(
  visits: readonly Visit[],
  tracks: readonly Track[],
  selectedIds: ReadonlySet<string>,
): { items: LabelItem[]; total: number } {
  const all: LabelItem[] = [];
  for (const v of visits) {
    if (selectedIds.has(v.id)) {
      all.push({ id: v.id, lng: v.lng, lat: v.lat, text: labelFor(v.start, true), ms: v.startMs });
    }
  }
  for (const t of tracks) {
    if (selectedIds.has(t.id) && t.path.length >= 2) {
      all.push({
        id: t.id,
        lng: t.path[0],
        lat: t.path[1],
        text: labelFor(t.start, true),
        ms: t.startMs,
      });
    }
  }
  all.sort((a, b) => b.ms - a.ms); // 최근 날짜가 먼저
  return { items: all.slice(0, LABEL_MAX), total: all.length };
}

export interface LabelItem {
  id: string;
  lng: number;
  lat: number;
  text: string;
  ms: number;
}

/**
 * 상태 → deck.gl 레이어 배열.
 *
 * 재생 중에는 이 함수가 다시 불리지 않는다 — currentTime 은 rAF 가
 * 레이어 프롭만 갈아끼워 갱신한다. 매 프레임 여기를 부르면
 * withRelativeTimeZ 가 트랙마다 새 배열을 만들어 GPU 버퍼가 다시 올라간다.
 */
export function buildLayers(input: LayerInput): Layer[] {
  const { visits, tracks, renderMode, selectedIds, tilesOn } = input;
  const layers: Layer[] = [];

  /*
   * 체류 집계 — 점과 궁적을 내리고 격자만 보여 준다.
   *
   * 12년치 점을 한 화면에 놓으면 서로 겹쳐 어디가 오래 머무른 곳인지
   * 보이지 않는다. 칸별로 더해 숫자로 적으면 한눈에 드러난다.
   */
  // 집계 중에는 격자만 보인다 — 점·궤적이 그 위를 덮으면 읽을 수 없다
  if (tilesOn) return layers;

  if (renderMode) {
    if (tracks.length > 0) layers.push(glowLayer(input));
    return layers;
  }

  // ── 편집 모드 — 경로를 옅게 깔고 체류점을 위에 ──
  if (tracks.length > 0) {
    const common = {
      data: tracks,
      getPath: (d: Track) => d.path,
      getColor: (d: Track) =>
        selectedIds.has(d.id)
          ? SELECTED_COLOR
          : d.kind === "path"
            ? PATH_COLOR
            : ACTIVITY_COLOR,
      capRounded: true,
      jointRounded: true,
      // 편집 모드에서만 집을 수 있다 — 시각화 모드는 감상용이다
      pickable: true,
      autoHighlight: true,
      updateTriggers: { getColor: [selectedIds] },
      positionFormat: "XY" as const,
      widthUnits: "pixels" as const,
    };
    layers.push(
      input.showArrows
        ? // 방향 화살표 — 참조 원본(trip)의 ArrowPathLayer 그대로. 선 본체까지
          // 이 레이어가 그리므로 일반 선 레이어는 두지 않는다.
          //
          // id 는 반드시 일반 선("paths")과 **달라야** 한다. deck.gl 은 id 만
          // 보고 레이어를 이어 붙이며 클래스가 바뀌어도 확인하지 않는다
          // (layer-manager.js). 같은 id 를 쓰면 화살표 레이어가 일반 선의
          // 상태 — 이미 컴파일된 일반 셰이더 모델 — 를 물려받아, 화살표
          // 주입은 한 번도 컴파일되지 않고 선만 밴드 폭으로 굵어진다.
          new ArrowPathLayer<Track>({
            ...common,
            id: "paths-arrows",
            getWidth: 16,
            // 기본 72px 의 3배 — 화살표를 드물게 놓아 선을 덮지 않게 한다
            arrowSpacingPx: 216,
            // 조각 하나가 곧 한 이동이라 누적 모드 — 세그먼트 단위로 재면
            // 1분 간격 GPS 샘플 사이가 너무 짧아 화살표가 들어가지 않는다
            arrowContinuous: true,
          })
        : new PathLayer<Track>({ ...common, id: "paths", getWidth: 2, widthMinPixels: 1 }),
    );
  }

  if (visits.length > 0) {
    layers.push(
      new ScatterplotLayer<Visit>({
        id: "visits",
        data: visits,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => (selectedIds.has(d.id) ? SELECTED_COLOR : VISIT_COLOR),
        // 선택한 점은 크게 — 작은 점 위의 색 변화만으로는 눈에 띄지 않는다
        getRadius: (d) => (selectedIds.has(d.id) ? 7 : 4),
        radiusUnits: "pixels",
        radiusMinPixels: 2,
        radiusMaxPixels: 12,
        pickable: true,
        autoHighlight: true,
        updateTriggers: { getFillColor: [selectedIds], getRadius: [selectedIds] },
      }),
    );
  }

  // 선택한 것에만 날짜를 찍는다 (최대 LABEL_MAX 개)
  const { items } = labelTargets(visits, tracks, selectedIds);
  if (items.length > 0) {
    layers.push(
      new TextLayer<LabelItem>({
        id: "labels",
        data: items,
        getPosition: (d) => [d.lng, d.lat],
        getText: (d) => d.text,
        getSize: 12,
        sizeUnits: "pixels",
        getColor: [255, 255, 255, 255],
        // 한글이 섞이면 기본 문자셋으로는 글자가 빈칸으로 나온다
        characterSet: "auto",
        fontFamily: '"Pretendard Variable", Pretendard, system-ui, sans-serif',
        background: true,
        getBackgroundColor: [20, 24, 32, 220],
        backgroundPadding: [5, 3],
        getPixelOffset: [0, -14],
        pickable: false,
        updateTriggers: { getText: [selectedIds] },
      }),
    );
  }

  return layers;
}

function glowLayer(input: LayerInput): Layer {
  const {
    tracks, glowStyle, timeFiltered, currentTime, trailDuration, timeOrigin, zMetersPerSecond,
  } = input;
  const stacked = zMetersPerSecond > 0;
  const common = {
    data: tracks,
    // 색은 셰이더가 그라데이션으로 결정한다 — 이 백색은 계산 기준점일 뿐
    getColor: [255, 255, 255, 255] as [number, number, number, number],
    // 발광 후광까지 포함한 밴드 폭
    getWidth: 10,
    widthScale: glowStyle.widthScale,
    widthUnits: "pixels" as const,
    capRounded: true,
    jointRounded: true,
    arrowContinuous: true,
    pickable: false,
    glowFromColor: glowStyle.from,
    glowToColor: glowStyle.to,
    parameters: GLOW_PARAMETERS,
    updateTriggers: {
      widthScale: [glowStyle.widthScale],
      glowFromColor: [glowStyle.from],
      glowToColor: [glowStyle.to],
    },
  };

  if (timeFiltered) {
    // 정점별 시각은 좌표의 z 로 실어 보낸다 (GlowTripsLayer 주석 참고) —
    // deck.gl 이 attribute transform 에 행 인덱스를 주지 않으므로
    // 별도 인스턴스 어트리뷰트를 쓸 수 없다. 레이어가 positionFormat 을
    // "XYZ" 로 강제하므로 여기서 넘기지 않는다.
    return new GlowTripsLayer<Track>({
      ...common,
      id: "glow-trips",
      getPath: (d) =>
        GlowTripsLayer.withRelativeTimeZ(d.path, d.times, timeOrigin, zMetersPerSecond),
      currentTime,
      trailDuration,
      timeOrigin,
      zMetersPerSecond,
      updateTriggers: {
        ...common.updateTriggers,
        getPath: [timeOrigin, zMetersPerSecond],
      },
    });
  }

  // 정지 상태에서도 z 를 쌓는다 (사용자 지정: 재생·정지 모두 적용).
  // 배율 0 이면 평면 — 좌표를 그대로 넘겨 변환 비용도 들지 않는다.
  if (stacked) {
    return new GlowPathLayer<Track>({
      ...common,
      id: "glow",
      getPath: (d) =>
        GlowTripsLayer.withRelativeTimeZ(d.path, d.times, timeOrigin, zMetersPerSecond),
      positionFormat: "XYZ",
      updateTriggers: {
        ...common.updateTriggers,
        getPath: [timeOrigin, zMetersPerSecond],
      },
    });
  }

  return new GlowPathLayer<Track>({
    ...common,
    id: "glow",
    getPath: (d) => d.path,
    positionFormat: "XY",
    // 쌓기 분기와 **같은 키**의 트리거를 둬야 한다. deck.gl 은 새 props 에
    // 있는 트리거만 검사하므로(props.js diffUpdateTriggers), 쌓기 → 납작으로
    // 올 때 여기 getPath 키가 없으면 "바뀐 게 없다" 로 보고 좌표를 다시 읽지
    // 않는다(path-layer.js updateState). 그러면 이전 XYZ 좌표가 그대로 남아
    // 슬라이더를 0 으로 내려도 궤적이 떠 있었다 — 슬라이더 step 이 0.02 라
    // 마지막으로 읽힌 좌표가 2% 높이라 "약간" 떠 보였다.
    updateTriggers: {
      ...common.updateTriggers,
      getPath: [timeOrigin, zMetersPerSecond],
    },
  });
}
