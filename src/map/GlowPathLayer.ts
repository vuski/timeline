import type { DefaultProps } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { ShaderModule } from "@luma.gl/shadertools";
import ArrowPathLayer, {
  arrowShaderInject,
  type ArrowPathLayerProps,
} from "./ArrowPathLayer";

/**
 * 발광 궤적 레이어 — 렌더링 모드(타임라인) 전용 (2026-08-30).
 *
 * shadearth 프로젝트의 glowTrailLine 셰이더를 deck.gl PathLayer 위에 이식했다:
 * glow = exp(-d²·3), centerBoost = 1+3(1-d), fwidth 안티앨리어싱, hdrIntensity 0.7,
 * 속도색(vColor)은 CPU 에서 mix(하늘색, 빨강, v/900km/h) — glowRouteLayers 참고.
 * 원본의 "시간 꼬리" 대신 경로 전체를 꼬리로 본다: 출발점이 꼬리 끝(투명),
 * 도착점이 머리(밝음) — alpha = √t (t = 경로 진행률).
 *
 * ArrowPathLayer 를 상속해 누적 곡선 길이 어트리뷰트(instanceArrowStarts/Totals)를
 * 물려받는다 — t 계산이 세그먼트가 아니라 경로 전체 기준이 되는 근거.
 * 셰이더 주입과 uniform 은 통째로 교체하므로 화살표는 그려지지 않는다.
 *
 * 원본은 mipmap bloom 후처리로 빛 번짐을 더했다 — 여기는 후처리가 없어서
 * boost(기본 4)로 밝기를 보상한다. 겹칠수록 하얗게 타오르는 건 additive
 * 블렌딩의 몫이므로 사용처에서 parameters 로 반드시 켜야 한다 (GLOW_PARAMETERS).
 */

const uniformBlock = `\
uniform glowFxUniforms {
  float hdrIntensity;
  float boost;
  vec4 fromColor;
  vec4 toColor;
} glowFx;
`;

export type GlowUniformProps = {
  hdrIntensity: number;
  boost: number;
  /** 출발점(꼬리 끝) 색 — 0~1 정규화 RGBA */
  fromColor: [number, number, number, number];
  /** 도착점(머리) 색 — 0~1 정규화 RGBA */
  toColor: [number, number, number, number];
};

// luma 규약: 블록 이름은 반드시 <name>Uniforms, 인스턴스는 <name> — 어긋나면
// "Binding 미발견" 경고만 남기고 레이어가 조용히 안 그려진다 (실측)
export const glowUniforms = {
  name: "glowFx",
  fs: uniformBlock,
  uniformTypes: {
    hdrIntensity: "f32",
    boost: "f32",
    fromColor: "vec4<f32>",
    toColor: "vec4<f32>",
  },
} as const satisfies ShaderModule<GlowUniformProps>;

export const glowShaderInject = {
  // 누적 길이 varying 은 ArrowPathLayer 의 vs 주입을 그대로 재사용
  "vs:#decl": arrowShaderInject["vs:#decl"],
  "vs:#main-end": arrowShaderInject["vs:#main-end"],
  "fs:#decl": `\
in float vArrowStart;
in float vArrowTotal;
vec4 glowResult = vec4(0.0);
`,
  "fs:#main-start": `\
{
  float d = abs(vPathPosition.x);
  float fw = fwidth(d);
  float aa = 1.0 - smoothstep(1.0 - fw, 1.0, d);
  float t = clamp((vArrowStart + vPathPosition.y) / max(vArrowTotal, 0.001), 0.0, 1.0);
  float glow = exp(-d * d * 3.0);
  float centerBoost = 1.0 + 3.0 * (1.0 - d);
  // 출발점 → 도착점 색·투명도를 경로 진행률로 섮는다. 사용자가 고른 alpha 가
  // 꼬리 페이드를 결정한다 — 원본의 고정 pow(t,0.5) 를 대체한다 (2026-08-30)
  vec4 grad = mix(glowFx.fromColor, glowFx.toColor, t);
  float alpha = grad.a * glow * aa;
  glowResult = vec4(
    grad.rgb * 0.08 * glow * centerBoost * glowFx.hdrIntensity * glowFx.boost,
    alpha);
}
`,
  "fs:#main-end": `\
if (!bool(picking.isActive)) {
  fragColor = glowResult;
}
`,
} as const;

/** additive 블렌딩 — 겹치는 궤적이 밝게 쌓인다 (참조 이미지의 핵심) */
export const GLOW_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: "always",
  blend: true,
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendColorOperation: "add",
  blendAlphaSrcFactor: "one-minus-dst-alpha",
  blendAlphaDstFactor: "one",
  blendAlphaOperation: "add",
} as const;

type _GlowPathLayerProps = {
  /** 원본 uHdrIntensity. @default 0.7 */
  glowHdrIntensity?: number;
  /** bloom 후처리 부재 보상 배율. @default 4 */
  glowBoost?: number;
  /** 출발점 색 RGBA (0~255, a 도 0~255). @default 웜 오렌지 · 투명 */
  glowFromColor?: [number, number, number, number];
  /** 도착점 색 RGBA (0~255, a 도 0~255). @default 웜 오렌지 · 불투명 */
  glowToColor?: [number, number, number, number];
};

/** 기본 출발점 #0CE9E5 (청록) — 꼬리 끝이라 투명 (2026-08-30 사용자 지정) */
export const GLOW_FROM_DEFAULT: [number, number, number, number] = [12, 233, 229, 0];
/** 기본 도착점 #CB2C10 (붉은 주황), 투명도 0.85 (2026-08-30 사용자 지정) */
export const GLOW_TO_DEFAULT: [number, number, number, number] = [203, 44, 16, 217];

export type GlowPathLayerProps<DataT = unknown> = _GlowPathLayerProps &
  ArrowPathLayerProps<DataT>;

const defaultProps: DefaultProps<GlowPathLayerProps> = {
  glowHdrIntensity: { type: "number", value: 0.7, min: 0 },
  glowBoost: { type: "number", value: 4, min: 0 },
  glowFromColor: { type: "array", value: GLOW_FROM_DEFAULT, compare: true },
  glowToColor: { type: "array", value: GLOW_TO_DEFAULT, compare: true },
};

export default class GlowPathLayer<
  DataT = unknown,
  ExtraProps extends Record<string, unknown> = Record<string, unknown>,
> extends ArrowPathLayer<DataT, Required<_GlowPathLayerProps> & ExtraProps> {
  static layerName = "GlowPathLayer";
  static defaultProps = defaultProps;

  getShaders() {
    // 부모(ArrowPathLayer)가 아니라 PathLayer 의 셰이더에서 출발해야 한다 —
    // 부모 getShaders 는 화살표 inject 를 넣는다. super 체인상 PathLayer 의
    // getShaders 를 직접 부를 수 없으므로 부모 결과의 inject/모듈을 교체한다.
    const shaders = super.getShaders();
    shaders.inject = glowShaderInject;
    shaders.modules = [
      ...shaders.modules.filter((m: { name?: string }) => m.name !== "arrow"),
      glowUniforms,
    ];
    return shaders;
  }

  draw(params: { uniforms: Record<string, unknown> }) {
    const { glowHdrIntensity, glowBoost, glowFromColor, glowToColor } = this.props;
    const norm = (c: [number, number, number, number]) =>
      [c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255] as [number, number, number, number];
    const glowProps: GlowUniformProps = {
      hdrIntensity: glowHdrIntensity,
      boost: glowBoost,
      fromColor: norm(glowFromColor),
      toColor: norm(glowToColor),
    };
    const model = this.state.model!;
    model.shaderInputs.setProps({ glowFx: glowProps });
    // 주의: ArrowPathLayer.draw 를 타면 arrow uniform 블록(여기선 제거됨)을
    // set 하려다 죽는다 — 조부모 PathLayer.draw 로 직행한다.
    (PathLayer.prototype.draw as (p: unknown) => void).call(this, params);
  }
}
