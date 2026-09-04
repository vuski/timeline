import { describe, expect, it } from "vitest";
import { formatDuration, formatPlayDate, type DurationUnits } from "../play/timeMapping";

const U: DurationUnits = { year: "년", month: "개월", day: "일", hour: "시간", minute: "분" };

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MONTH = DAY * 30.44;
const YEAR = DAY * 365.25;

describe("formatDuration", () => {
  it("분 단위", () => {
    expect(formatDuration(20 * MIN, U)).toBe("20분");
  });

  it("1분 미만도 최소 1분으로 (0분은 쓸모없다)", () => {
    expect(formatDuration(5000, U)).toBe("1분");
  });

  it("시간 단위 — 10시간 미만은 소수 한 자리", () => {
    expect(formatDuration(3.5 * HOUR, U)).toBe("3.5시간");
    expect(formatDuration(12 * HOUR, U)).toBe("12시간");
  });

  it("일 단위", () => {
    expect(formatDuration(2.5 * DAY, U)).toBe("2.5일");
    expect(formatDuration(12 * DAY, U)).toBe("12일");
  });

  it("개월 + 일", () => {
    expect(formatDuration(MONTH * 2 + DAY * 3, U)).toBe("2개월 3일");
  });

  it("나머지 일이 0 이면 개월만", () => {
    expect(formatDuration(MONTH * 2, U)).toBe("2개월");
  });

  it("년 + 개월 — 12년의 10% 는 1년 2개월", () => {
    expect(formatDuration(12 * 365 * DAY * 0.1, U)).toBe("1년 2개월");
  });

  it("개월이 12로 반올림되면 해를 올린다 (1년 12개월 방지)", () => {
    // 1년 + 11.6개월 → 12개월로 반올림 → 2년
    expect(formatDuration(YEAR + MONTH * 11.6, U)).toBe("2년");
  });

  it("나머지 개월이 0 이면 년만", () => {
    expect(formatDuration(YEAR * 3, U)).toBe("3년");
  });

  it("0 이하·비정상 입력도 죽지 않는다", () => {
    expect(formatDuration(0, U)).toBe("0분");
    expect(formatDuration(-1, U)).toBe("0분");
    expect(formatDuration(Number.NaN, U)).toBe("0분");
  });
});

describe("formatPlayDate", () => {
  it("현지 날짜를 적는다", () => {
    const out = formatPlayDate(Date.parse("2015-06-01T12:00:00Z"), "ko-KR");
    expect(out).toMatch(/2015/);
    expect(out.length).toBeGreaterThan(0);
  });

  it("비정상 입력은 빈 문자열", () => {
    expect(formatPlayDate(Number.NaN, "ko-KR")).toBe("");
  });
});
