import type { DefaultProps } from "@deck.gl/core";
import { PathLayer, type PathLayerProps } from "@deck.gl/layers";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * 방향 화살표가 새겨진 경로 레이어 — 타임라인 이동선용 (A안, 2026-08-29).
 *
 * PathLayer 지오메트리를 화살표 폭(getWidth, 픽셀)만큼 넓게 잡고, 프래그먼트
 * 셰이더가 그 밴드 안에 ①가는 선 본체 ②진행 방향 제비꼬리 화살표(네 점 다트,
 * 사용자 스케치 비례: 높이 H, 반폭 0.5H, 꼬리 파임 H/3)를 채워 그린다.
 * PathLayer 의 경로 좌표(vPathPosition·vPathLength)는 half-width 단위라
 * halfWidthPx 만 곱하면 화면 픽셀이 된다 — 화살표 간격이 줌과 무관하게
 * 화면 기준으로 일정하고, 인스턴스 재계산이 아예 없다.
 *
 * 세그먼트의 화면 길이가 minLenPx(50px) 미만이면 화살표를 통째로 생략한다 —
 * 줌아웃 시 촘촘한 세그먼트마다 화살표가 뭉쳐 떡이 되는 것 방지 (사용자 지시).
 *
 * 제약: getWidth 는 상수(픽셀)여야 한다 — draw() 가 그 값을 uniform 으로 넘긴다.
 * 주입 지점·varying 이름은 deck.gl 버전에 묶인다 (9.3 기준, dash 확장과 동일 문법).
 */

const uniformBlock = `\
uniform arrowUniforms {
  float halfWidthPx;
  float spacingPx;
  float minLenPx;
  float corePx;
  float sizePx;
  float continuous;
} arrow;
`;

export type ArrowUniformProps = {
  halfWidthPx: number;
  spacingPx: number;
  minLenPx: number;
  corePx: number;
  sizePx: number;
  /** 1 이면 누적 모드 — 잘게 쪼갠 곡선(연결선 베지어)을 한 줄로 취급 */
  continuous: number;
};

export const arrowUniforms = {
  name: "arrow",
  fs: uniformBlock,
  uniformTypes: {
    halfWidthPx: "f32",
    spacingPx: "f32",
    minLenPx: "f32",
    corePx: "f32",
    sizePx: "f32",
    continuous: "f32",
  },
} as const satisfies ShaderModule<ArrowUniformProps>;

/**
 * 프래그먼트 주입 — dash 확장처럼 fs:#main-start 에서 경로 좌표를 읽는다.
 * (DECKGL_FILTER_COLOR 훅 안에서는 vPathPosition 스코프가 보장되지 않는다)
 * picking 패스에서는 색을 건드리지 않는다 — 인코딩 색이 깨진다 (dash 와 동일 규약).
 */
export const arrowShaderInject = {
  // 누적 곡선 길이 — dash 확장의 instanceDashOffsets 와 같은 기법. width.x(공통
  // 좌표 반폭)로 나누면 vPathPosition.y 와 같은 half-width 단위가 된다
  "vs:#decl": `\
in float instanceArrowStarts;
in float instanceArrowTotals;
out float vArrowStart;
out float vArrowTotal;
`,
  "vs:#main-end": `\
vArrowStart = instanceArrowStarts / width.x;
vArrowTotal = instanceArrowTotals / width.x;
`,
  // uniform 블록은 모듈(arrowUniforms)이 자동 선언한다 — 여기 다시 넣으면 이중
  // 선언으로 컴파일이 깨진다 (실측). decl 에는 전역 변수만.
  "fs:#decl": `\
in float vArrowStart;
in float vArrowTotal;
float arrowAlphaMul = 1.0;
`,
  "fs:#main-start": `\
if (!bool(picking.isActive)) {
  float hw = arrow.halfWidthPx;
  float aPx = vPathPosition.x * hw;
  // 누적 모드(continuous)면 세그먼트가 아니라 경로 전체 기준 좌표 — 33점 베지어처럼
  // 잘게 쪼갠 곡선은 세그먼트가 수 px 라 세그먼트 기준으론 화살표가 아예 안 나온다
  bool cont = arrow.continuous > 0.5;
  float alongPx = (cont ? vArrowStart + vPathPosition.y : vPathPosition.y) * hw;
  float lenPx = (cont ? vArrowTotal : vPathLength) * hw;

  // 선 본체 — 세그먼트마다 양끝이 둥근 가는 선 (이어 그리면 연속으로 보인다).
  // corePx 0 은 본체 생략 (연결선: 점선 본체는 기존 PathLayer 가 그린다)
  float core = 0.0;
  if (arrow.corePx > 0.0) {
    float beyond = max(max(-alongPx, alongPx - lenPx), 0.0);
    float coreDist = length(vec2(aPx, beyond));
    core = 1.0 - smoothstep(arrow.corePx - 0.75, arrow.corePx + 0.75, coreDist);
  }

  // 제비꼬리 화살표(채운 다트, 사용자 스케치 비례) — minLenPx 미만 세그먼트는 생략.
  // 좌우대칭이라 |across| 로 접어 오른쪽 반쪽만 판정: 꼭짓점 T(+H/2, 0),
  // 날개 W(-H/2, H/2), 꼬리 파임 N(-H/6, 0) 삼각형 안 = 바깥변·꼬리변 두 반평면
  float dart = 0.0;
  if (lenPx >= arrow.minLenPx) {
    float H = arrow.sizePx;
    float u = mod(alongPx, arrow.spacingPx) - arrow.spacingPx * 0.5;
    float center = alongPx - u;
    if (center > H && center < lenPx - H) {
      float s = abs(aPx);
      // 바깥변 T->W (단위방향 (-2,1)/sqrt5): 부호 있는 거리, 안쪽 양수
      float d1 = -0.8944 * s - 0.4472 * (u - 0.5 * H);
      // 꼬리변 W->N (단위방향 (2,-3)/sqrt13): 안쪽(앞쪽) 양수
      float d2 = 0.5547 * (s - 0.5 * H) + 0.8321 * (u + 0.5 * H);
      dart = smoothstep(-0.75, 0.75, min(d1, d2));
    }
  }

  arrowAlphaMul = max(core, dart * 1.6);
  if (arrowAlphaMul < 0.02) {
    discard;
  }
}
`,
  "fs:#main-end": `\
if (!bool(picking.isActive)) {
  fragColor.a = min(1.0, fragColor.a * arrowAlphaMul);
}
`,
} as const;

type _ArrowPathLayerProps = {
  /** 화살표 간격 — 화면 픽셀. @default 72 */
  arrowSpacingPx?: number;
  /** 이보다 짧은(화면 px) 세그먼트는 화살표 생략. @default 50 */
  arrowMinLenPx?: number;
  /**
   * 화살표 세로 크기(진행 방향, px) — 반폭 0.5H·꼬리 파임 H/3 은 이 값에서
   * 비례 파생 (사용자 스케치). 밴드 폭(getWidth)이 H 이상이어야 잘리지 않는다.
   * @default 12
   */
  arrowSizePx?: number;
  /**
   * 선 본체 반폭(px, 완성 두께 약 2배) — 0 이면 본체를 그리지 않고 화살표만
   * (연결선처럼 본체를 다른 레이어가 그릴 때). @default 1
   */
  coreLinePx?: number;
  /**
   * 누적 모드 — 잘게 쪼갠 곡선(연결선 베지어)을 경로 전체 기준으로 취급한다.
   * 간격·생략 규칙이 세그먼트가 아니라 곡선 전체 화면 길이에 걸린다.
   * false(기본)면 세그먼트 단위 — 타임라인처럼 경유지 사이 구간이 의미 단위일 때.
   * @default false
   */
  arrowContinuous?: boolean;
};

export type ArrowPathLayerProps<DataT = unknown> = _ArrowPathLayerProps &
  PathLayerProps<DataT>;

const defaultProps: DefaultProps<ArrowPathLayerProps> = {
  arrowSpacingPx: { type: "number", value: 72, min: 1 },
  arrowMinLenPx: { type: "number", value: 50, min: 0 },
  arrowSizePx: { type: "number", value: 12, min: 1 },
  coreLinePx: { type: "number", value: 1, min: 0 },
  arrowContinuous: false,
};

export default class ArrowPathLayer<
  DataT = unknown,
  ExtraProps extends Record<string, unknown> = Record<string, unknown>,
> extends PathLayer<DataT, Required<_ArrowPathLayerProps> & ExtraProps> {
  static layerName = "ArrowPathLayer";
  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    shaders.inject = arrowShaderInject;
    shaders.modules = [...shaders.modules, arrowUniforms];
    return shaders;
  }

  initializeState() {
    super.initializeState();
    // 누적 곡선 길이 어트리뷰트 — PathStyleExtension 의 instanceDashOffsets 와 같은
    // 확장 문법(accessor getPath + transform). 세그먼트 i 는 배열[i] 값을 받는다.
    this.getAttributeManager()!.addInstanced({
      instanceArrowStarts: {
        size: 1,
        accessor: "getPath",
        transform: this.arrowStartsOf.bind(this),
      },
      instanceArrowTotals: {
        size: 1,
        accessor: "getPath",
        transform: this.arrowTotalsOf.bind(this),
      },
    });
  }

  /** 각 정점까지의 누적 곡선 길이 (공통 좌표) — dash 확장 getDashOffsets 이식 */
  private projectedVertices(path: unknown): number[][] {
    const positionSize = this.props.positionFormat === "XY" ? 2 : 3;
    const flat = path as number[];
    const isNested = Array.isArray((path as unknown[])[0]);
    const n = isNested ? (path as unknown[]).length : flat.length / positionSize;
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const p = isNested
        ? ((path as number[][])[i] as number[])
        : flat.slice(i * positionSize, i * positionSize + positionSize);
      out.push(this.projectPosition(p));
    }
    return out;
  }

  private arrowStartsOf(path: unknown): number[] {
    const v = this.projectedVertices(path);
    const out = [0];
    for (let i = 1; i < v.length; i++) {
      out.push(out[i - 1] + dist2(v[i - 1], v[i]));
    }
    return out;
  }

  private arrowTotalsOf(path: unknown): number[] {
    const starts = this.arrowStartsOf(path);
    const total = starts[starts.length - 1] ?? 0;
    return starts.map(() => total);
  }

  draw(params: { uniforms: Record<string, unknown> }) {
    const {
      getWidth,
      arrowSpacingPx,
      arrowMinLenPx,
      arrowSizePx,
      coreLinePx,
      arrowContinuous,
    } = this.props;
    // getWidth 상수 계약 — accessor 함수가 오면 기본 폭으로 그린다 (조용한 오동작 방지)
    const widthPx = typeof getWidth === "number" ? getWidth : 14;
    const arrowProps: ArrowUniformProps = {
      halfWidthPx: widthPx / 2,
      spacingPx: arrowSpacingPx,
      minLenPx: arrowMinLenPx,
      corePx: coreLinePx,
      sizePx: arrowSizePx,
      continuous: arrowContinuous ? 1 : 0,
    };
    const model = this.state.model!;
    model.shaderInputs.setProps({ arrow: arrowProps });
    super.draw(params);
  }
}

/** 두 공통 좌표 사이 거리 (xy 평면 — 지도 경로에 z 는 없다) */
function dist2(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
