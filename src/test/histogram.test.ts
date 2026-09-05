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

/*
 * 막대 높이는 개수가 아니라 체류 시간이다.
 *
 * 개수로 세면 짧은 방문 여러 번과 긴 체류 하나가 구분되지 않아,
 * 기록이 통째로 빠진 시기를 볼 수 없다.
 */
describe("체류 시간으로 센다", () => {
  const stay = (start: string, hours: number) => ({
    start,
    end: new Date(Date.parse(start) + hours * 3_600_000).toISOString(),
  });

  it("막대 높이가 머문 시간(분)이다", () => {
    const bars = monthlyHistogram([stay("2015-06-01T00:00:00.000Z", 2)]);
    expect(bars[0].count).toBe(120);
  });

  it("같은 달의 체류를 더한다", () => {
    const bars = monthlyHistogram([
      stay("2015-06-01T00:00:00.000Z", 2),
      stay("2015-06-20T00:00:00.000Z", 3),
    ]);
    expect(bars[0].count).toBe(300);
  });

  /* 이게 이 변경의 목적이다 — 개수로는 둘이 같아 보인다 */
  it("짧은 방문 여러 번과 긴 체류 하나를 구분한다", () => {
    const many = monthlyHistogram([
      stay("2015-06-01T00:00:00.000Z", 0.5),
      stay("2015-06-02T00:00:00.000Z", 0.5),
      stay("2015-06-03T00:00:00.000Z", 0.5),
    ]);
    const one = monthlyHistogram([stay("2015-06-01T00:00:00.000Z", 100)]);
    expect(many[0].count).toBe(90);
    expect(one[0].count).toBe(6000);
    expect(one[0].count).toBeGreaterThan(many[0].count);
  });

  it("일별도 같은 규칙으로 센다", () => {
    const bars = dailyHistogram(
      [stay("2015-06-01T00:00:00.000Z", 4)],
      "2015-06-01",
      "2015-06-02",
    );
    expect(bars.map((b) => b.count)).toEqual([240, 0]);
  });

  /*
   * end 가 없거나 시각이 뒤집힌 항목도 "있었다" 는 표시는 남아야 한다.
   * 0 으로 두면 기록이 아예 없던 달과 구분되지 않는다.
   */
  it("머문 시간을 알 수 없으면 1 로 친다", () => {
    expect(monthlyHistogram([{ start: "2015-06-01T00:00:00.000Z" }])[0].count).toBe(1);
    expect(
      monthlyHistogram([
        { start: "2015-06-01T00:00:00.000Z", end: "2015-05-01T00:00:00.000Z" },
      ])[0].count,
    ).toBe(1);
    expect(
      monthlyHistogram([{ start: "2015-06-01T00:00:00.000Z", end: "깨진값" }])[0].count,
    ).toBe(1);
  });
});
