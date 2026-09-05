import { describe, expect, it } from "vitest";
import { tileFrames } from "../map/TileOverlay";
import type { TileStay } from "../data/tiles";

/**
 * 지도 대역 — project 만 있으면 된다.
 *
 * 경위도를 그대로 픽셀로 친다(lng → x, lat → y). 실제 투영과 다르지만,
 * 여기서 보려는 것은 "화면 밖 칸을 걸러내는가" 이므로 좌표가 단순할수록
 * 무엇을 검사하는지 분명해진다.
 */
function fakeMap(w = 800, h = 600) {
  return {
    project: ([lng, lat]: [number, number]) => ({ x: lng, y: lat }),
    getContainer: () => ({ clientWidth: w, clientHeight: h }),
  } as unknown as Parameters<typeof tileFrames>[0];
}

const cell = (id: string, minutes: number, x: number, y: number, size = 100): TileStay =>
  ({
    id,
    x: 0,
    y: 0,
    z: 12,
    minutes,
    count: 1,
    polygon: [
      [x, y + size],
      [x + size, y + size],
      [x + size, y],
      [x, y],
    ],
    center: [x + size / 2, y + size / 2],
    hist: [],
  }) as unknown as TileStay;

const opts = { total: 1000, label: () => "3개월", area: () => "60km²" };

describe("tileFrames 컬링", () => {
  it("화면 안의 칸은 그린다", () => {
    const frames = tileFrames(fakeMap(), [cell("a", 100, 300, 200)], opts);
    expect(frames).toHaveLength(1);
  });

  /* 낮은 줌에서는 칸이 수백 개인데 대부분 화면 밖이다 */
  it("화면에서 멀리 벗어난 칸은 버린다", () => {
    const frames = tileFrames(
      fakeMap(),
      [cell("far", 100, 5000, 5000), cell("in", 100, 100, 100)],
      opts,
    );
    expect(frames).toHaveLength(1);
  });

  /* 조금이라도 걸치면 그린다 — 경계에서 사라지면 눈에 띈다 */
  it("가장자리에 걸친 칸은 그린다", () => {
    const frames = tileFrames(fakeMap(800, 600), [cell("edge", 100, -50, 300)], opts);
    expect(frames).toHaveLength(1);
  });

  /*
   * 색의 기준은 컬링 전에 잡아야 한다. 화면에 든 칸만으로 최소·최대를
   * 구하면, 집을 화면 밖으로 밀어냈을 때 남은 칸들이 갑자기 진해진다.
   */
  it("화면 밖 칸도 색의 기준에 넣는다", () => {
    const inView = cell("in", 100, 100, 100);
    const huge = cell("huge", 100000, 5000, 5000);

    const alone = tileFrames(fakeMap(), [inView], opts)[0].alpha;
    const withHuge = tileFrames(fakeMap(), [inView, huge], opts)[0].alpha;

    // 훨씬 오래 머문 칸이 밖에 있으면, 안의 칸은 상대적으로 옅어야 한다
    expect(withHuge).toBeLessThan(alone);
  });
});
