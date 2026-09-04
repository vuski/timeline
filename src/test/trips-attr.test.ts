import { describe, expect, it } from "vitest";
import GlowTripsLayer, { FLAT_Z_PER_SEC } from "../map/GlowTripsLayer";
import type { Track } from "../types";

const track: Track = {
  id: "t0",
  path: Float64Array.from([127, 37, 127.1, 37.1]),
  times: Float64Array.from([1000, 2000]),
  startMs: 1000, endMs: 2000,
  start: "2015-06-01T10:00:00.000+09:00", kind: "path",
};

/**
 * 이 스위트는 브리프가 지정한 "deck.gl 이 attribute `transform` 에
 * `{ index }` 컨텍스트를 넘긴다"는 가정을 검증한다.
 *
 * 손으로 만든 `{ index: 0 }` 를 넘겨 부르면(브리프 원안의 트릭) transform
 * 함수 자체의 내부 로직만 확인할 뿐 "deck.gl 이 실제로 그 인자를 주는가"는
 * 증명하지 못한다. 그래서 deck.gl 의 실제 호출 규약을 소스에서 그대로
 * 재현해 검증한다.
 *
 * 근거 (node_modules/@deck.gl/core/dist/lib/attribute/attribute.js,
 * 설치된 버전 9.3.11, `_autoUpdater`, addInstanced + accessor + transform
 * 조합 — 정확히 이 레이어가 쓰려던 방식):
 *   accessorFunc(object, objectInfo)   // accessor: (object, {index}) — 2 인자
 *   transform.call(this, objectValue)  // transform: (value) — this=attribute, 인자 1개
 *
 * 결론: **가정 FAILED.** `{ index }` 는 `transform` 에 전달되지 않는다.
 * 그래서 GlowTripsLayer 는 인스턴스 어트리뷰트 + transform 방식을 쓰지
 * 않고, 브리프 Step 5 의 대안(정점별 시각을 좌표 z 로 실어
 * `positionFormat: "XYZ"`)으로 구현했다 — 아래 두 번째 describe 가 그
 * 대안 경로를 확인한다.
 */
describe("deck.gl attribute transform 호출 규약 (실측, 가정 검증)", () => {
  it("deck.gl _autoUpdater 는 transform 을 (value) 인자 1개로만 부른다 — { index } 없음", () => {
    const objectValue = track.path; // accessorFunc(object, objectInfo) 의 반환값 역할
    const capturedArgs: unknown[][] = [];
    const fakeTransform = (...args: unknown[]) => {
      capturedArgs.push(args);
      return args[0];
    };
    const fakeAttributeThis = { id: "instanceTimes" };
    // attribute.js 실제 호출부 재현: transform.call(this, objectValue)
    fakeTransform.call(fakeAttributeThis, objectValue);
    expect(capturedArgs[0]).toHaveLength(1);
    expect(capturedArgs[0][0]).toBe(objectValue);
  });
});

/**
 * 대안 경로(Step 5 fallback) 확인 — 어트리뷰트 확장 없이, 정점별 시각을
 * path 좌표의 z 성분으로 실어 positionFormat: "XYZ" 로 넘긴다. GL 컨텍스트
 * 없이도 순수 함수(withRelativeTimeZ)와 레이어 기본 프롭만으로 계약을
 * 검증할 수 있다.
 */
describe("z-좌표 fallback — 어트리뷰트 계약 우회", () => {
  it("GlowTripsLayer 는 positionFormat 을 XYZ 로 강제한다", () => {
    expect(GlowTripsLayer.defaultProps.positionFormat).toBe("XYZ");
  });

  it("withRelativeTimeZ 가 z 에 고도(미터)를 싣는다 — 배율 × 상대 초", () => {
    // 배율 100 m/s, 상대 초 0·1 → 고도 0·100m
    const out = GlowTripsLayer.withRelativeTimeZ(track.path, track.times, 1000, 100);
    expect(Array.from(out)).toEqual([127, 37, 0, 127.1, 37.1, 100]);
  });

  it("배율을 생략하면 납작 — z 가 상대 초가 아니라 극소 고도가 된다", () => {
    // 여기서 상대 초를 그대로 실으면 deck.gl 이 그것을 미터 고도로 읽어
    // 궤적이 화면 밖으로 날아간다 (실제로 있었던 버그)
    const out = GlowTripsLayer.withRelativeTimeZ(track.path, track.times, 1000);
    expect(out[5]).toBe(1 * FLAT_Z_PER_SEC);
    expect(out[5]).toBeLessThan(0.001);
  });

  it("well-formed 2-정점 트랙은 [lng,lat,z, lng,lat,z] 을 만든다", () => {
    const path = Float64Array.from([10, 20, 30, 40]);
    const times = Float64Array.from([5000, 7000]);
    const out = GlowTripsLayer.withRelativeTimeZ(path, times, 5000, 100);
    expect(Array.from(out)).toEqual([10, 20, 0, 30, 40, 200]);
  });

  it("path/times 길이가 안 맞으면 던진다 — 어긋나면 z 슬롯에 조용히 NaN/undefined 가 들어간다", () => {
    const path = Float64Array.from([127, 37, 127.1, 37.1, 127.2, 37.2]); // 3 정점
    const times = Float64Array.from([1000, 2000]); // 2 개뿐
    expect(() => GlowTripsLayer.withRelativeTimeZ(path, times, 1000)).toThrow(
      /길이 불일치/,
    );
  });

  it("행 인덱스나 컨텍스트 없이도 성립한다 — deck.gl attribute manager 를 거치지 않는다", () => {
    // z 인코딩은 getPath 호출 시점(행 단위)에 CPU 에서 끝나므로, deck.gl 이
    // transform 에 컨텍스트를 주는지와 무관하게 항상 정확하다.
    const layer = new GlowTripsLayer<Track>({
      id: "probe",
      data: [track],
      getPath: (d) => GlowTripsLayer.withRelativeTimeZ(d.path, d.times, 1000),
      timeOrigin: 1000,
    });
    expect(layer.props.positionFormat).toBe("XYZ");
  });
});

describe("납작 모드 (z 배율 0)", () => {
  it("z 를 사실상 0 으로 눌러 화면 밖으로 날아가지 않는다", () => {
    // 12년치 상대 초를 그대로 z 에 실으면 378,000km 고도가 된다 —
    // FLAT_Z_PER_SEC 로 눌러 40m 이하로 유지한다
    const twelveYearsMs = 12 * 365 * 86_400_000;
    const out = GlowTripsLayer.withRelativeTimeZ(
      Float64Array.from([127, 37, 128, 38]),
      Float64Array.from([0, twelveYearsMs]),
      0,
      0, // 납작
    );
    expect(out[2]).toBe(0);
    expect(out[5]).toBeGreaterThan(0); // 시간 정보는 살아 있다
    expect(out[5]).toBeLessThan(50); // 미터 — 평면과 구분되지 않는다
  });

  it("납작 모드에서도 시각을 복원할 수 있다 (셰이더가 같은 배율로 나눈다)", () => {
    const relSec = 1_000_000;
    const out = GlowTripsLayer.withRelativeTimeZ(
      Float64Array.from([127, 37, 128, 38]),
      Float64Array.from([0, relSec * 1000]),
      0,
      0,
    );
    expect(out[5] / FLAT_Z_PER_SEC).toBeCloseTo(relSec, 0);
  });
});
