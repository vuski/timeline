import { describe, expect, it } from "vitest";
import { filterByRange, inRange, monthRange, dayRange, dayNum, numDay } from "../data/range";

describe("inRange — 문자열 접두 비교", () => {
  const r = { from: "2015-06-01T00:00", to: "2015-06-30T23:59" };

  it("구간 안이면 참", () => {
    expect(inRange("2015-06-15T12:00:00.000+09:00", r)).toBe(true);
  });

  it("양끝을 포함한다", () => {
    expect(inRange("2015-06-01T00:00:00.000+09:00", r)).toBe(true);
    expect(inRange("2015-06-30T23:59:59.000+09:00", r)).toBe(true);
  });

  it("구간 밖이면 거짓", () => {
    expect(inRange("2015-05-31T23:59:00.000+09:00", r)).toBe(false);
    expect(inRange("2015-07-01T00:00:00.000+09:00", r)).toBe(false);
  });

  it("null 구간은 전부 통과", () => {
    expect(inRange("1999-01-01T00:00:00.000+09:00", null)).toBe(true);
  });

  it("시간대 오프셋이 달라도 표기 그대로 비교한다", () => {
    // 같은 현지 표기면 오프셋이 무엇이든 같은 날로 취급 — Date 로 바꾸면 밀린다
    expect(inRange("2015-06-15T12:00:00.000-05:00", r)).toBe(true);
    expect(inRange("2015-06-15T12:00:00.000+09:00", r)).toBe(true);
  });
});

describe("filterByRange", () => {
  const items = [
    { start: "2015-05-01T10:00:00.000+09:00" },
    { start: "2015-06-15T10:00:00.000+09:00" },
    { start: "2015-07-01T10:00:00.000+09:00" },
  ];

  it("구간에 든 것만 남긴다", () => {
    const r = { from: "2015-06-01T00:00", to: "2015-06-30T23:59" };
    expect(filterByRange(items, r)).toHaveLength(1);
  });

  it("null 이면 원본 그대로", () => {
    expect(filterByRange(items, null)).toHaveLength(3);
  });
});

describe("구간 키 변환", () => {
  it("월 키를 그 달 전체로", () => {
    expect(monthRange("2015-06")).toEqual(["2015-06-01T00:00", "2015-06-30T23:59"]);
  });

  it("2월 윤년을 안다", () => {
    expect(monthRange("2016-02")[1]).toBe("2016-02-29T23:59");
    expect(monthRange("2015-02")[1]).toBe("2015-02-28T23:59");
  });

  it("일 키를 그 날 전체로", () => {
    expect(dayRange("2015-06-15")).toEqual(["2015-06-15T00:00", "2015-06-15T23:59"]);
  });
});

describe("dayNum / numDay 왕복", () => {
  it("문자열 ↔ 일수가 서로 되돌아온다", () => {
    expect(numDay(dayNum("2015-06-15"))).toBe("2015-06-15");
    expect(numDay(dayNum("2016-02-29"))).toBe("2016-02-29");
  });
});
