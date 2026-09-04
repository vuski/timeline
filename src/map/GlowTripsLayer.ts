import type { DefaultProps } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { ShaderModule } from "@luma.gl/shadertools";
import GlowPathLayer, {
  glowShaderInject, type GlowPathLayerProps, type GlowUniformProps,
} from "./GlowPathLayer";

/**
 * 시간 필터가 붙은 발광 궤적 — 재생의 핵심 (설계 §4.6).
 *
 * 원리: **시간은 uniform, 공간은 레이어**.
 * 정점별 시각을 정점 좌표의 z 성분으로 한 번만 올려 두고(`positionFormat:
 * "XYZ"`), 매 프레임 `currentTime` uniform 하나만 갱신한다. 데이터
 * 재업로드도, 레이어 재생성도, React 리렌더도 없다 — 그래서 20만 정점이어도
 * 60fps 다.
 *
 * 프래그먼트 셰이더가 `age = currentTime - vTime` 을 보고 시간창 밖을
 * discard 한다. "특정 시간대만 셰이더에서 필터링" 이 정확히 이것이다.
 *
 * 정밀도: epoch ms(1.7e12)는 f32 유효숫자 7자리로 초 단위가 뭉개진다.
 * timeOrigin(구간 시작)을 빼고 **초 단위**로 바꿔 CPU 에서 미리 변환해
 * z 에 실어 GPU 로 넘긴다.
 *
 * **경로: Step 5 fallback (계약 실패 확정).**
 * 설계가 상정한 "deck.gl 이 attribute `transform` 에 `{ index }` 컨텍스트를
 * 준다"는 가정은 deck.gl 9.3.11 에서 성립하지 않는다 — 실제 소스
 * (`@deck.gl/core` `Attribute._autoUpdater`) 는 `transform.call(this,
 * objectValue)` 로 **인자 하나만** 넘긴다 (`this` 는 context 가 아니라
 * attribute 인스턴스). `../test/trips-attr.test.ts` 가 deck.gl 의 실제
 * 호출 규약을 재현해 이를 증명한다. 그래서 정점별 시각은 별도 인스턴스
 * 어트리뷰트가 아니라, **PathLayer 가 이미 정점마다 넘겨주는 위치 좌표의
 * z 성분**으로 실어 보낸다 — `getPath` 가 `[lng, lat, relSec, lng, lat,
 * relSec, …]` 를 반환하고 `positionFormat: "XYZ"` 로 선언하면, PathLayer
 * 의 `instanceStartPositions`/`instanceEndPositions` (원시 vec3, project_position
 * 투영 전) 에 relSec 이 그대로 실린다. 어트리뷰트 확장이 통째로 필요 없다.
 */

/**
 * 납작 모드에서 쓰는 최소 z 배율 (상대 초 1 당 미터).
 *
 * 0 을 쓰면 z 에 상대 초가 그대로 남고, deck.gl 이 그것을 고도로 해석해
 * 12년 구간이 378,000km 높이로 날아가 화면에서 사라진다. 그렇다고 z 를
 * 통째로 0 으로 만들면 시간 정보가 사라져 꼬리 판정을 못 한다.
 *
 * 그래서 아주 작은 배율을 쓴다: 12년(약 3.8e8 초)에서도 최대 고도가
 * 38m 라 지도에서 평면과 구분되지 않고, f32 로도 초 단위가 살아남는다.
 *
 * **더 낮추지 말 것.** 1e-10 으로 내렸더니 재생 시 궤적이 통째로 사라졌다 —
 * 셰이더는 project_position 을 거친 뒤의 z 를 읽는데, 그 좌표계에서 값이
 * 0 으로 뭉개져 모든 정점의 시각이 0 이 되고 꼬리 필터가 전부 걸러 냈다.
 * 납작 모드에서 떠 보이는 문제는 z 가 아니라 카메라 pitch 쪽이다.
 */
export const FLAT_Z_PER_SEC = 1e-7;

const uniformBlock = `\
uniform tripsUniforms {
  float currentTime;
  float trailDuration;
  // z 에 실린 고도(미터)를 상대 초로 되돌리는 나눗셈 인자.
  // 0 이면 z 가 곧 상대 초(고도 0, 평면 모드)라는 뜻.
  float zMetersPerSecond;
} trips;
`;

export type TripsUniformProps = {
  /** timeOrigin 기준 상대 초 */
  currentTime: number;
  /** 꼬리 길이 — 초 */
  trailDuration: number;
  /** z(미터) → 상대 초 환산 인자. 0 이면 z 가 곧 상대 초 */
  zMetersPerSecond: number;
};

export const tripsUniforms = {
  name: "trips",
  fs: uniformBlock,
  vs: uniformBlock,
  uniformTypes: {
    currentTime: "f32",
    trailDuration: "f32",
    zMetersPerSecond: "f32",
  },
} as const satisfies ShaderModule<TripsUniformProps>;

export const tripsShaderInject = {
  // instanceTimes 어트리뷰트는 없다 — 정점별 시각은 instanceStartPositions.z /
  // instanceEndPositions.z (positionFormat: "XYZ" 로 실어 온 원시 z) 에서 읽는다.
  // PathLayer 베이스 셰이더가 이미 그 vec3 들을 선언해 두었으므로 vs:#decl 에
  // 새 in 변수가 필요 없다 — vTime varying 만 추가한다.
  "vs:#decl": `\
${glowShaderInject["vs:#decl"]}
out float vTime;
`,
  // isEnd(0=시작점, 1=끝점) 로 두 후보 z 를 섞는다 — main() 의 isEnd 계산과
  // 같은 값이라 여기서 다시 계산한다 (project_position 이 z 를 지우기 전,
  // main-end 시점엔 이미 project 가 끝난 뒤라 main-start 에서 뽑아 둔다)
  "vs:#main-start": `\
{
  // z 에는 항상 "고도(미터)" 가 실려 있다. 시간창 판정은 초 단위라
  // 같은 배율로 나눠 되돌린다. 배율은 납작 모드에서도 0 이 아니므로
  // (FLAT_Z_PER_SEC) 여기서 0 나눗셈을 걱정할 필요가 없다.
  float zRaw = mix(instanceStartPositions.z, instanceEndPositions.z, positions.x);
  vTime = zRaw / max(trips.zMetersPerSecond, 1e-12);
}
`,
  "vs:#main-end": glowShaderInject["vs:#main-end"],
  "fs:#decl": `\
${glowShaderInject["fs:#decl"]}
in float vTime;
float tripsFade = 1.0;
`,
  // 시간창 판정을 먼저 하고(버릴 것은 일찍 버린다), 통과한 것만 발광을 계산한다
  "fs:#main-start": `\
{
  // age 가 trailDuration 에 가까워질수록 꼬리가 fade out 된다 (선형 페이드)
  float age = trips.currentTime - vTime;
  if (age < 0.0 || age > trips.trailDuration) {
    discard;
  }
  tripsFade = 1.0 - age / trips.trailDuration;
}
${glowShaderInject["fs:#main-start"]}
`,
  "fs:#main-end": `\
if (!bool(picking.isActive)) {
  fragColor = vec4(glowResult.rgb * tripsFade, glowResult.a * tripsFade);
}
`,
} as const;

type _GlowTripsLayerProps = {
  /** 현재 시각 (epoch ms) */
  currentTime?: number;
  /** 꼬리 길이 (ms) */
  trailDuration?: number;
  /** f32 정밀도를 지키기 위한 기준 시각 (epoch ms) — 보통 구간 시작 */
  timeOrigin?: number;
  /** z 에 실린 고도 배율 (상대 초 1 당 미터). 0 이면 평면 */
  zMetersPerSecond?: number;
};

export type GlowTripsLayerProps<DataT = unknown> = _GlowTripsLayerProps &
  GlowPathLayerProps<DataT>;

const defaultProps: DefaultProps<GlowTripsLayerProps> = {
  currentTime: { type: "number", value: 0 },
  trailDuration: { type: "number", value: 3_600_000, min: 1 },
  timeOrigin: { type: "number", value: 0 },
  // z 를 상대 초로 쓰므로 XYZ 를 강제한다 — getPath 가 [lng,lat,relSec,...] 를
  // 반환해야 한다 (positionFormat: "XY" 로 부르면 z 가 없어 조용히 깨진다)
  positionFormat: "XYZ",
};

export default class GlowTripsLayer<
  DataT = unknown,
  ExtraProps extends Record<string, unknown> = Record<string, unknown>,
> extends GlowPathLayer<DataT, Required<_GlowTripsLayerProps> & ExtraProps> {
  static layerName = "GlowTripsLayer";
  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    shaders.inject = tripsShaderInject;
    // super(GlowPathLayer)가 이미 glowUniforms 를 넣고 "arrow" 모듈을
    // 걸러냈다 — 이 레이어가 새로 추가하는 건 tripsUniforms 하나뿐이다.
    shaders.modules = [...shaders.modules, tripsUniforms];
    return shaders;
  }

  /**
   * `getPath` 가 반환하는 좌표에 정점별 상대 초를 z 로 실어 넣는 헬퍼.
   * `timeOrigin` 기준 상대 초로 바꿔 f32 정밀도를 지킨다.
   *
   * 사용처(호출부)에서 `getPath` 를 이 헬퍼로 감싸 `[lng, lat, relSec, …]`
   * 를 만든다 — 예: `getPath: (d) => GlowTripsLayer.withRelativeTimeZ(d.path,
   * d.times, timeOrigin)`.
   */
  static withRelativeTimeZ(
    path: Float64Array | number[],
    times: Float64Array | number[],
    timeOrigin: number,
    /**
     * z 에 실을 고도 배율 — 상대 초 1 당 미터. 0 을 주면 FLAT_Z_PER_SEC
     * 로 대체해 사실상 평면이 되면서도 시간 정보는 보존한다.
     * 셰이더가 같은 배율로 나눠 시간을 되돌린다.
     */
    zMetersPerSecond = 0,
  ): Float64Array {
    const zScale = zMetersPerSecond > 0 ? zMetersPerSecond : FLAT_Z_PER_SEC;
    if (path.length !== times.length * 2) {
      throw new Error(
        `withRelativeTimeZ: path/times 길이 불일치 (path ${path.length}, times ${times.length})`,
      );
    }
    const n = times.length;
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = path[i * 2];
      out[i * 3 + 1] = path[i * 2 + 1];
      out[i * 3 + 2] = ((times[i] - timeOrigin) / 1000) * zScale;
    }
    return out;
  }

  draw(params: { uniforms: Record<string, unknown> }) {
    const {
      glowHdrIntensity, glowBoost, glowFromColor, glowToColor,
      currentTime, trailDuration, timeOrigin, zMetersPerSecond,
    } = this.props;
    const norm = (c: [number, number, number, number]) =>
      [c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255] as [number, number, number, number];
    const model = this.state.model!;
    model.shaderInputs.setProps({
      glowFx: {
        hdrIntensity: glowHdrIntensity,
        boost: glowBoost,
        fromColor: norm(glowFromColor),
        toColor: norm(glowToColor),
      } satisfies GlowUniformProps,
      trips: {
        currentTime: (currentTime - timeOrigin) / 1000,
        trailDuration: trailDuration / 1000,
        // withRelativeTimeZ 와 반드시 같은 값이어야 시간이 정확히 복원된다
        zMetersPerSecond: zMetersPerSecond > 0 ? zMetersPerSecond : FLAT_Z_PER_SEC,
      } satisfies TripsUniformProps,
    });
    // 조부모 PathLayer.draw 로 직행 — 부모들의 draw 는 제거된 uniform 블록을
    // set 하려다 죽는다 (GlowPathLayer 주석 참고)
    (PathLayer.prototype.draw as (p: unknown) => void).call(this, params);
  }
}
