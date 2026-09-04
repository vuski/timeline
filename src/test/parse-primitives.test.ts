import { describe, expect, it } from "vitest";
import { parseLatLng } from "../data/parseTimeline";

describe("parseLatLng", () => {
  it("도 기호가 붙은 실제 표기를 읽는다", () => {
    expect(parseLatLng("37.5205413°, 126.8820833°")).toEqual([37.5205413, 126.8820833]);
  });

  it("도 기호가 깨져 있어도 읽는다 (인코딩 손상 대비)", () => {
    expect(parseLatLng("37.5205264��, 126.8821109��")).toEqual([
      37.5205264, 126.8821109,
    ]);
  });

  it("음수 좌표를 읽는다", () => {
    expect(parseLatLng("-33.8688°, 151.2093°")).toEqual([-33.8688, 151.2093]);
  });

  it("위도 범위를 벗어나면 null", () => {
    expect(parseLatLng("91.0°, 126.0°")).toBeNull();
  });

  it("문자열이 아니거나 형식이 아니면 null", () => {
    expect(parseLatLng(null)).toBeNull();
    expect(parseLatLng("")).toBeNull();
    expect(parseLatLng("abc")).toBeNull();
  });
});
