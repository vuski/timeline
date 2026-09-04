import { describe, expect, it } from "vitest";
import {
  advance, defaultSpeed, defaultTrailMs, formatStampYM, progressOf, TARGET_SECONDS,
  timeAtProgress,
} from "../play/timeMapping";

const DAY = 86_400_000;
const span = { startMs: 0, endMs: 30 * DAY };

describe("defaultSpeed", () => {
  it("구간을 약 30초에 통과하는 배율을 고른다", () => {
    const s = defaultSpeed(span);
    expect((span.endMs - span.startMs) / s).toBeCloseTo(TARGET_SECONDS, 5);
  });

  it("길이가 0 인 구간에서도 0 으로 나누지 않는다", () => {
    expect(Number.isFinite(defaultSpeed({ startMs: 5, endMs: 5 }))).toBe(true);
    expect(defaultSpeed({ startMs: 5, endMs: 5 })).toBeGreaterThan(0);
  });
});

describe("advance", () => {
  it("경과 시간(ms)을 초로 환산해 속도를 곱한 만큼 나아간다", () => {
    // speed 는 "초당 데이터 ms" — 1000ms(=1초) 경과 × 100 = 100ms 전진
    expect(advance(0, 1000, 100, span)).toBe(100);
  });

  it("끝에 닿으면 처음으로 되돌아온다 (반복 재생)", () => {
    const t = advance(span.endMs - 10, 1000, 1000, span);
    expect(t).toBeGreaterThanOrEqual(span.startMs);
    expect(t).toBeLessThan(span.endMs);
  });

  it("여러 바퀴를 건너뛰어도 구간 안에 머문다", () => {
    const t = advance(0, 1000, span.endMs * 5, span);
    expect(t).toBeGreaterThanOrEqual(span.startMs);
    expect(t).toBeLessThan(span.endMs);
  });

  it("길이가 0 인 구간은 시작점에 머문다", () => {
    expect(advance(5, 1000, 100, { startMs: 5, endMs: 5 })).toBe(5);
  });
});

describe("progressOf / timeAtProgress 왕복", () => {
  it("진행률과 시각이 서로 되돌아온다", () => {
    expect(progressOf(timeAtProgress(0.25, span), span)).toBeCloseTo(0.25, 10);
  });

  it("양끝은 0 과 1", () => {
    expect(progressOf(span.startMs, span)).toBe(0);
    expect(progressOf(span.endMs, span)).toBe(1);
  });

  it("범위를 벗어난 진행률은 잘린다", () => {
    expect(timeAtProgress(-1, span)).toBe(span.startMs);
    expect(timeAtProgress(2, span)).toBe(span.endMs);
  });

  it("길이가 0 인 구간의 진행률은 0", () => {
    expect(progressOf(5, { startMs: 5, endMs: 5 })).toBe(0);
  });
});

describe("defaultTrailMs", () => {
  it("구간 길이에 비례한 꼬리 (짧은 구간엔 짧은 꼬리)", () => {
    const long = defaultTrailMs(span);
    const short = defaultTrailMs({ startMs: 0, endMs: DAY });
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(0);
  });
});

describe("formatStampYM", () => {
  it("YYYY-MM 으로 적는다 (달은 두 자리)", () => {
    const ms = new Date(2015, 5, 17, 13, 40).getTime();
    expect(formatStampYM(ms)).toBe("2015-06");
  });

  it("10월 이후도 두 자리 그대로", () => {
    expect(formatStampYM(new Date(2020, 11, 1).getTime())).toBe("2020-12");
  });

  it("숫자가 아니면 빈 문자열", () => {
    expect(formatStampYM(Number.NaN)).toBe("");
  });
});
