import { describe, expect, it } from "vitest";
import GlowTripsLayer, { tripsShaderInject, tripsUniforms } from "../map/GlowTripsLayer";
import GlowPathLayer from "../map/GlowPathLayer";

describe("GlowTripsLayer", () => {
  it("GlowPathLayer 를 상속한다 (발광은 그대로 물려받는다)", () => {
    expect(Object.getPrototypeOf(GlowTripsLayer)).toBe(GlowPathLayer);
    expect(GlowTripsLayer.layerName).toBe("GlowTripsLayer");
  });

  it("uniform 블록 이름이 luma 규약을 지킨다", () => {
    expect(tripsUniforms.name).toBe("trips");
    expect(tripsUniforms.fs).toContain("uniform tripsUniforms");
    expect(tripsUniforms.fs).toContain("} trips;");
  });

  it("currentTime 과 trailDuration uniform 을 선언한다", () => {
    expect(tripsUniforms.uniformTypes).toMatchObject({
      currentTime: "f32",
      trailDuration: "f32",
    });
  });

  it("정점별 시각을 varying 으로 넘긴다 (z 성분 fallback — 아래 '어트리뷰트 계약' 참고)", () => {
    // instanceTimes 인스턴스 어트리뷰트가 아니라 positionFormat: XYZ 로 실어 온
    // instanceStartPositions.z / instanceEndPositions.z 에서 vTime 을 뽑는다
    expect(tripsShaderInject["vs:#main-start"]).toContain("instanceStartPositions.z");
    expect(tripsShaderInject["vs:#main-start"]).toContain("instanceEndPositions.z");
    expect(tripsShaderInject["vs:#decl"]).toContain("vTime");
  });

  it("시간창 밖 프래그먼트를 버린다 — 이것이 '느리지 않은' 이유", () => {
    const fs = tripsShaderInject["fs:#main-start"];
    expect(fs).toContain("discard");
    expect(fs).toContain("trips.currentTime");
    expect(fs).toContain("trips.trailDuration");
  });

  it("아직 오지 않은 시각(age < 0)도 버린다", () => {
    expect(tripsShaderInject["fs:#main-start"]).toContain("age < 0.0");
  });

  it("꼬리는 나이에 따라 사라진다", () => {
    expect(tripsShaderInject["fs:#main-start"]).toContain("fade");
  });

  it("기본 프롭이 정의돼 있다", () => {
    expect(GlowTripsLayer.defaultProps.currentTime).toBeDefined();
    expect(GlowTripsLayer.defaultProps.trailDuration).toBeDefined();
    expect(GlowTripsLayer.defaultProps.timeOrigin).toBeDefined();
  });

  it("positionFormat 을 XYZ 로 강제한다 (z 가 상대 초를 실어 나른다)", () => {
    expect(GlowTripsLayer.defaultProps.positionFormat).toBe("XYZ");
  });

  it("withRelativeTimeZ 가 [lng,lat,relSec,...] 를 만든다", () => {
    const path = Float64Array.from([127, 37, 127.1, 37.1]);
    const times = Float64Array.from([1000, 2000]);
    // 배율 100 m/s → 상대 초 0·1 이 고도 0·100m 로 실린다
    const out = GlowTripsLayer.withRelativeTimeZ(path, times, 1000, 100);
    expect(Array.from(out)).toEqual([127, 37, 0, 127.1, 37.1, 100]);
  });
});

describe("정밀도 — 상대 초 변환", () => {
  it("epoch ms 를 그대로 f32 에 넣으면 초 단위가 뭉개진다 (변환의 근거)", () => {
    const epoch = 1_750_000_000_000;
    const asF32 = Math.fround(epoch);
    expect(Math.abs(asF32 - epoch)).toBeGreaterThan(1000);
  });

  it("timeOrigin 을 빼고 초로 바꾸면 f32 안에서 정확하다", () => {
    const origin = 1_750_000_000_000;
    const t = origin + 12_345_678;
    const rel = (t - origin) / 1000;
    expect(Math.fround(rel)).toBeCloseTo(rel, 3);
  });
});
