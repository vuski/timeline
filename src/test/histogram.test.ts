import { describe, expect, it } from "vitest";
import { dailyHistogram, monthlyHistogram } from "../data/histogram";

const items = [
  { start: "2015-05-30T10:00:00.000+09:00" },
  { start: "2015-06-01T10:00:00.000+09:00" },
  { start: "2015-06-01T20:00:00.000+09:00" },
  { start: "2015-08-01T10:00:00.000+09:00" },
];

describe("monthlyHistogram", () => {
  it("방문 없는 달도 0 으로 채운다 (시간축이 끊기면 안 된다)", () => {
    const bars = monthlyHistogram(items);
    expect(bars.map((b) => b.key)).toEqual(["2015-05", "2015-06", "2015-07", "2015-08"]);
    expect(bars.map((b) => b.count)).toEqual([1, 2, 0, 1]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(monthlyHistogram([])).toEqual([]);
  });

  it("해가 바뀌어도 이어진다", () => {
    const bars = monthlyHistogram([
      { start: "2015-12-01T00:00:00.000+09:00" },
      { start: "2016-01-01T00:00:00.000+09:00" },
    ]);
    expect(bars.map((b) => b.key)).toEqual(["2015-12", "2016-01"]);
  });
});

describe("dailyHistogram", () => {
  it("빈 날을 0 으로 채운다", () => {
    const bars = dailyHistogram(items, "2015-05-30", "2015-06-02");
    expect(bars.map((b) => b.key)).toEqual([
      "2015-05-30", "2015-05-31", "2015-06-01", "2015-06-02",
    ]);
    expect(bars.map((b) => b.count)).toEqual([1, 0, 2, 0]);
  });
});
