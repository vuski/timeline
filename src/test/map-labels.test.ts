import { describe, expect, it } from "vitest";
import { applyMapLabels } from "../map/mapLanguage";

/** setLayoutProperty 호출을 기록하는 최소 지도 대역 */
function fakeMap(layers: unknown[]) {
  const calls: { id: string; prop: string; value: unknown }[] = [];
  const map = {
    getStyle: () => ({ layers }),
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      calls.push({ id, prop, value });
    },
  };
  return { map, calls };
}

const textLayer = (id: string) => ({ id, type: "symbol", layout: { "text-field": ["get", "name"] } });

describe("applyMapLabels", () => {
  it("글자 레이어를 감춘다", () => {
    const { map, calls } = fakeMap([textLayer("place-city"), textLayer("place-town")]);
    applyMapLabels(map as never, false);
    expect(calls).toEqual([
      { id: "place-city", prop: "visibility", value: "none" },
      { id: "place-town", prop: "visibility", value: "none" },
    ]);
  });

  it("다시 켜면 visible 로 되돌린다", () => {
    const { map, calls } = fakeMap([textLayer("place-city")]);
    applyMapLabels(map as never, true);
    expect(calls[0].value).toBe("visible");
  });

  // symbol 이라도 글자가 없는 레이어(아이콘 전용)는 건드리면 기호까지 사라진다
  it("text-field 없는 symbol 레이어는 남긴다", () => {
    const { map, calls } = fakeMap([
      { id: "airport-icon", type: "symbol", layout: { "icon-image": "airport" } },
      textLayer("place-city"),
    ]);
    applyMapLabels(map as never, false);
    expect(calls.map((c) => c.id)).toEqual(["place-city"]);
  });

  it("symbol 이 아닌 레이어는 건드리지 않는다", () => {
    const { map, calls } = fakeMap([
      { id: "water", type: "fill", layout: {} },
      { id: "road", type: "line", layout: {} },
    ]);
    applyMapLabels(map as never, false);
    expect(calls).toEqual([]);
  });

  it("스타일이 없어도 터지지 않는다", () => {
    const map = { getStyle: () => undefined, setLayoutProperty: () => {} };
    expect(() => applyMapLabels(map as never, false)).not.toThrow();
  });

  // 레이어 하나가 실패해도 나머지는 계속 바꿔야 한다
  it("한 레이어가 던져도 나머지를 계속 처리한다", () => {
    const calls: string[] = [];
    const map = {
      getStyle: () => ({ layers: [textLayer("bad"), textLayer("good")] }),
      setLayoutProperty: (id: string) => {
        if (id === "bad") throw new Error("gone");
        calls.push(id);
      },
    };
    applyMapLabels(map as never, false);
    expect(calls).toEqual(["good"]);
  });
});
