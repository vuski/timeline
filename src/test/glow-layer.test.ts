import { describe, expect, it } from "vitest";
import GlowPathLayer, {
  GLOW_FROM_DEFAULT, GLOW_PARAMETERS, GLOW_TO_DEFAULT, glowShaderInject, glowUniforms,
} from "../map/GlowPathLayer";
import ArrowPathLayer, { arrowShaderInject } from "../map/ArrowPathLayer";

describe("ArrowPathLayer", () => {
  it("PathLayer 를 상속한다", () => {
    expect(ArrowPathLayer.layerName).toBe("ArrowPathLayer");
  });

  it("누적 길이 varying 을 정점 셰이더에 주입한다", () => {
    expect(arrowShaderInject["vs:#decl"]).toContain("instanceArrowStarts");
    expect(arrowShaderInject["vs:#decl"]).toContain("instanceArrowTotals");
  });
});

describe("GlowPathLayer", () => {
  it("ArrowPathLayer 를 상속한다 (누적 길이 어트리뷰트를 물려받는다)", () => {
    expect(Object.getPrototypeOf(GlowPathLayer)).toBe(ArrowPathLayer);
    expect(GlowPathLayer.layerName).toBe("GlowPathLayer");
  });

  it("uniform 블록 이름이 luma 규약(<name>Uniforms/<name>)을 지킨다", () => {
    // 어긋나면 경고만 남기고 레이어가 조용히 안 그려진다
    expect(glowUniforms.name).toBe("glowFx");
    expect(glowUniforms.fs).toContain("uniform glowFxUniforms");
    expect(glowUniforms.fs).toContain("} glowFx;");
  });

  it("additive 블렌딩 — 겹치는 궤적이 밝게 쌓인다", () => {
    expect(GLOW_PARAMETERS.blend).toBe(true);
    expect(GLOW_PARAMETERS.blendColorDstFactor).toBe("one");
    expect(GLOW_PARAMETERS.blendColorOperation).toBe("add");
  });

  it("깊이 쓰기를 끈다 (반투명 궤적이 서로를 가리면 안 된다)", () => {
    expect(GLOW_PARAMETERS.depthWriteEnabled).toBe(false);
  });

  it("기본 색은 출발점 투명 → 도착점 불투명", () => {
    expect(GLOW_FROM_DEFAULT[3]).toBe(0);
    expect(GLOW_TO_DEFAULT[3]).toBeGreaterThan(0);
  });

  it("발광 셰이더가 경로 진행률로 색을 섞는다", () => {
    expect(glowShaderInject["fs:#main-start"]).toContain("glowFx.fromColor");
    expect(glowShaderInject["fs:#main-start"]).toContain("glowFx.toColor");
  });

  it("picking 패스에서는 색을 건드리지 않는다 (인코딩 색이 깨진다)", () => {
    expect(glowShaderInject["fs:#main-end"]).toContain("picking.isActive");
  });
});
