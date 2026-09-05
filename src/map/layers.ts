import type { Layer } from "@deck.gl/core";
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import ArrowPathLayer from "./ArrowPathLayer";
import GlowPathLayer, { GLOW_PARAMETERS } from "./GlowPathLayer";
import GlowTripsLayer from "./GlowTripsLayer";
import { logScale, stayShare, type TileStay } from "../data/tiles";
import type { Track, Visit } from "../types";
import type { GlowStyle } from "../state/useTimelineStore";

/*
 * 체류 집계 칸의 불투명도 범위.
 *
 * 밑을 55 로 두는 건 가장 짧은 칸도 배경지도 위에서 보이게 하려는 것이다.
 */
const TILE_ALPHA_MIN = 55;
const TILE_ALPHA_SPAN = 165;

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
   * 체류 집계 격자. 비어 있으면 그리지 않는다.
   * 넣으면 점·궁적 대신 이것만 보여준다.
   */
  tiles?: TileStay[];
  /** 칸 위에 쓸 글자 — 집계된 분을 사람이 읽는 말로 */
  tileLabel?: (minutes: number) => string;
  /** 칸의 넓이 — 왼쪽 아래에 작게 */
  tileArea?: (y: number, z: number) => string;
  /**
   * 비율의 분모 — 첫 기록부터 마지막 기록까지의 전체 시간(분).
   *
   * 여기서는 알 수 없어 밖에서 받는다. 없으면 집계 합으로 떨어지지만,
   * 그때는 화면의 숫자와 요약 줄이 서로 다른 분모를 쓰게 된다.
   */
  tileTotalMinutes?: number;
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
  const { visits, tracks, renderMode, selectedIds, tiles } = input;
  const layers: Layer[] = [];

  /*
   * 체류 집계 — 점과 궁적을 내리고 격자만 보여 준다.
   *
   * 12년치 점을 한 화면에 놓으면 서로 겹쳐 어디가 오래 머무른 곳인지
   * 보이지 않는다. 칸별로 더해 숫자로 적으면 한눈에 드러난다.
   */
  if (tiles && tiles.length > 0) return tileLayers(input, tiles);

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

/**
 * 체류 집계 격자 — 칸 + 그 위의 글자.
 *
 * 칸 색은 체류가 길수록 진하다. 최댓값을 기준으로 나누므로 집계 범위가
 * 바뀜도(기간 필터·줄) 대비가 유지된다 — 절대값으로 칠하면 짧은 기간을
 * 볼 때 온 칸이 투명해진다.
 */
function tileLayers(input: LayerInput, tiles: TileStay[]): Layer[] {
  const { tileLabel, tileArea, tileTotalMinutes } = input;
  /*
   * 비율의 분모는 전체 기간이다 — 화면에 분모가 적히지 않으니 보는 사람은
   * 당연히 "전체 중 몇 %" 로 읽는다. 그래서 칸들의 합은 100% 에 못 미치고,
   * 모자라는 몫이 이동 시간이다(요약 줄이 그 몫을 밝힌다).
   */
  const total =
    tileTotalMinutes && tileTotalMinutes > 0
      ? tileTotalMinutes
      : tiles.reduce((sum, d) => sum + d.minutes, 0);

  /*
   * 색은 로그 눈금으로 — "10배 더 오래 = 한 단계 진하게".
   *
   * 선형은 집(2,589일)이 나머지를 눌러 99%가 같은 색이 되고, 자연 분류는
   * 최상위 계급이 1.5일~2,589일을 한데 묶어버렸다(둘 다 실측). 체류시간은
   * 자릿수가 다른 값이라 로그가 맞는다.
   */
  const times = tiles.map((d) => d.minutes);
  const lo = Math.min(...times);
  const hi = Math.max(...times);

  return [
    new PolygonLayer<TileStay>({
      id: "tiles",
      data: tiles,
      getPolygon: (d) => d.polygon,
      // 점 색(#476bbf)과 같은 계열 — 같은 것을 다른 모양으로 보는 것이다
      getFillColor: (d) => [
        71, 107, 191,
        TILE_ALPHA_MIN + Math.round(logScale(d.minutes, lo, hi) * TILE_ALPHA_SPAN),
      ],
      getLineColor: [71, 107, 191, 220],
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      stroked: true,
      filled: true,
      pickable: true,
      updateTriggers: { getFillColor: [lo, hi] },
    }),
    new TextLayer<TileStay>({
      id: "tile-labels",
      data: tiles,
      getPosition: (d) => d.center,
      getText: (d) => (tileLabel ? tileLabel(d.minutes) : ""),
      getSize: 13,
      sizeUnits: "pixels",
      /*
       * 한글 단위("시간"·"개월")가 섞여 있다 — 기본 문자셋으로는 글자가
       * 소리 없이 빈칸으로 떨어진다(참조 프로젝트의 기록된 함정).
       */
      characterSet: "auto",
      fontFamily: '"Pretendard Variable", Pretendard, system-ui, sans-serif',
      /*
       * 글리프 아틀라스를 크게 굽는다. 기본 64px 를 13px 로 줄여 그리면
       * 밑맵이 없어 글자가 번진다 — 표시 크기의 몇 배로 구워야 선명하다.
       */
      fontSettings: { fontSize: 64 },
      // 검은 굵은 글씨 — 칸 바탕이 엷은 파랑이라 대비가 충분하다
      fontWeight: 700,
      getColor: [0, 0, 0, 255],
      getTextAnchor: "middle",
      // 위로 올려 아래에 비율 줄을 둘 자리를 만든다
      getAlignmentBaseline: "bottom",
      getPixelOffset: [0, 1],
      pickable: false,
      updateTriggers: { getText: [tileLabel] },
    }),
    /*
     * 비율은 따로 레이어로 — 같은 레이어에서 줄바꿈하면 두 줄이 크기와
     * 굵기를 공유해야 한다. 위는 크게, 아래는 작게 두려면 나눠야 한다.
     */
    /*
     * 순위 — 칸 왼쪽 위 모서리. 상위 N 을 골랐을 때만 매겨진다.
     *
     * 가운데의 시간·비율과 자리를 다투지 않게 모서리로 뺐다. polygon[3] 이
     * 북서쪽 꼭짓점이다(tilePolygon: [남서, 남동, 북동, 북서]).
     */
    new TextLayer<TileStay>({
      id: "tile-ranks",
      data: tiles,
      getPosition: (d) => d.polygon[3],
      getText: (d) => (d.rank ? String(d.rank) : ""),
      getSize: 15,
      sizeUnits: "pixels",
      characterSet: "auto",
      fontFamily: '"Pretendard Variable", Pretendard, system-ui, sans-serif',
      fontSettings: { fontSize: 64 },
      fontWeight: 700,
      getColor: [30, 58, 138, 255],
      // 꼭짓점에 딱 붙이지 않고 칸 안쪽으로 들인다
      getTextAnchor: "start",
      getAlignmentBaseline: "top",
      getPixelOffset: [4, 3],
      pickable: false,
      updateTriggers: { getText: [tiles] },
    }),
    /*
     * 넓이 — 칸 왼쪽 아래 모서리. polygon[0] 이 남서쪽 꼭짓점이다
     * (tilePolygon: [남서, 남동, 북동, 북서]).
     *
     * 순위(왼쪽 위)와 대각으로 갈라 가운데 숫자와 겹치지 않게 했다.
     * 가는 글씨로 옅게 — 늘 보고 있을 값은 아니고, 칸이 얼마만한지
     * 궁금할 때 눈에 들어오면 된다.
     */
    new TextLayer<TileStay>({
      id: "tile-areas",
      data: tiles,
      getPosition: (d) => d.polygon[0],
      getText: (d) => (tileArea ? tileArea(d.y, d.z) : ""),
      getSize: 10,
      sizeUnits: "pixels",
      characterSet: "auto",
      /*
       * 가는 검은 글씨.
       *
       * 흰 글씨에 외곽선을 둘러 봤지만, 10px 작은 글씨에는 외곽선이
       * 뭉개져 오히려 읽기 나빴다. 같은 칸의 시간·비율이 검은 글씨로
       * 잘 읽히므로(칸 알파 상한이 220이라 묻히지 않는다) 같은 길을
       * 따른다. 굵기만 낮춰 가운데 숫자에 앞서지 않게 한다.
       *
       * ── fontFamily 를 다른 레이어와 다르게 적는 이유 ──
       *
       * deck.gl 은 (fontFamily + fontSettings) 를 키로 글리프 아틀라스를
       * 캐시한다. fontWeight 는 그 키에 들어가지 않으므로, 같은 조합을
       * 쓰는 700 짜리 레이어가 먼저 아틀라스를 구우면 이 레이어는 그것을
       * 그대로 물려받아 굵기가 먹지 않는다. 실제로 100 을 줬는데 화면에는
       * 700 으로 나왔다.
       *
       * 폰트 자체는 같고 대체 목록만 한 단계 짧다 — 키를 갈라 별도
       * 아틀라스를 굽게 하려는 것뿐이다.
       */
      fontFamily: '"Pretendard Variable", Pretendard, sans-serif',
      /*
       * 다른 레이어(64)보다 크게 굽는다.
       *
       * 아틀라스를 64px 로 구워 10px 로 줄이면 6.4 배 축소다. 가는 획은
       * 그 과정에서 1px 아래로 내려가 회색으로 뭉개진다 — 굵기를 낮추자
       * 글씨가 흐려진 것이 이 때문이었다. 크게 구워 축소 배율을 낮추면
       * 가늘면서도 획이 또렷하게 남는다.
       */
      fontSettings: { fontSize: 96 },
      // 300 아래로는 10px 크기에서 획이 살아남지 못한다
      fontWeight: 300,
      getColor: [0, 0, 0],
      getTextAnchor: "start",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [4, -3],
      pickable: false,
      updateTriggers: { getText: [tileArea] },
    }),
    new TextLayer<TileStay>({
      id: "tile-shares",
      data: tiles,
      getPosition: (d) => d.center,
      getText: (d) => stayShare(d.minutes, total),
      getSize: 10,
      sizeUnits: "pixels",
      characterSet: "auto",
      fontFamily: '"Pretendard Variable", Pretendard, system-ui, sans-serif',
      fontSettings: { fontSize: 64 },
      fontWeight: 700,
      getColor: [0, 0, 0, 255],
      getTextAnchor: "middle",
      getAlignmentBaseline: "top",
      getPixelOffset: [0, 2],
      pickable: false,
      updateTriggers: { getText: [total] },
    }),
  ];
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
