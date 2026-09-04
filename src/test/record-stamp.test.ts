import { describe, expect, it } from "vitest";
import { captionLimit, drawFrame, VIDEO_REPO, VIDEO_TITLE } from "../share/record";

/** 호출 순서와 인자를 기록하는 2D 컨텍스트 대역 */
function fakeCtx(width = 1280, height = 720) {
  const calls: string[] = [];
  const fonts: string[] = [];
  const ctx = {
    canvas: { width, height },
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    miterLimit: 0,
    shadowColor: "",
    shadowBlur: 0,
    set font(v: string) {
      fonts.push(v);
    },
    get font() {
      return fonts[fonts.length - 1] ?? "";
    },
    clearRect: () => calls.push("clear"),
    drawImage: () => calls.push("draw"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    strokeText: (t: string) => calls.push(`stroke:${t}`),
    fillText: (t: string, x: number, y: number) => calls.push(`text:${t}|${x}|${y}`),
  };
  return { ctx, calls, fonts };
}

const src = {} as CanvasImageSource;
/** "text:<글자>|<x>|<y>" 에서 좌표를 꺼낸다 */
const at = (calls: string[], text: string) => {
  const hit = calls.find((c) => c.startsWith(`text:${text}|`));
  if (!hit) return null;
  const [, x, y] = hit.split("|");
  return { x: Number(x), y: Number(y) };
};

describe("drawFrame", () => {
  it("지도를 먼저 그리고 그 위에 글자를 올린다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06" });
    expect(calls.indexOf("draw")).toBeLessThan(calls.findIndex((c) => c.startsWith("text:")));
  });

  it("제목과 저장소는 상단에 이 순서로", () => {
    const { ctx, calls } = fakeCtx(1000, 600);
    drawFrame(ctx as never, src, { date: "2015-06" });
    const title = at(calls, VIDEO_TITLE)!;
    const repo = at(calls, VIDEO_REPO)!;
    expect(title.y).toBeLessThan(repo.y);
    // 상단 — 위쪽 절반 안
    expect(repo.y).toBeLessThan(300);
    expect([title.x, repo.x]).toEqual([500, 500]);
  });

  it("날짜는 하단, 사용자 문구 바로 위에 둔다", () => {
    const { ctx, calls } = fakeCtx(1000, 600);
    drawFrame(ctx as never, src, { date: "2015-06", caption: "나의 기록" });
    const repo = at(calls, VIDEO_REPO)!;
    const date = at(calls, "2015-06")!;
    const cap = at(calls, "나의 기록")!;
    // 상단 묶음보다 훨씬 아래, 그리고 문구 바로 위
    expect(date.y).toBeGreaterThan(repo.y);
    expect(date.y).toBeLessThan(cap.y);
    expect([date.x, cap.x]).toEqual([500, 500]);
    // 둘 다 하단 — 아래 절반
    expect(date.y).toBeGreaterThan(300);
  });

  // 문구가 없으면 날짜가 그 자리를 대신 차지해야 한다 — 빈 칸이 남지 않게
  it("문구가 없으면 날짜가 맨 아래로 내려온다", () => {
    const withCap = fakeCtx(1000, 600);
    drawFrame(withCap.ctx as never, src, { date: "2015-06", caption: "기록" });
    const noCap = fakeCtx(1000, 600);
    drawFrame(noCap.ctx as never, src, { date: "2015-06" });
    expect(at(noCap.calls, "2015-06")!.y).toBeGreaterThan(at(withCap.calls, "2015-06")!.y);
  });

  it("문구가 비면 하단에 아무것도 안 그린다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06", caption: "" });
    expect(calls.filter((c) => c.startsWith("text:"))).toHaveLength(3);
  });

  // 제목·날짜만 버퍼(검은 테두리)를 두른다 — 저장소·문구는 가늘게
  it("제목과 날짜에만 검은 버퍼를 두른다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06", caption: "기록" });
    const stroked = calls.filter((c) => c.startsWith("stroke:")).map((c) => c.slice(7));
    expect(stroked).toEqual([VIDEO_TITLE, "2015-06"]);
  });

  it("그리기 전에 캔버스를 지운다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06" });
    expect(calls[0]).toBe("clear");
  });

  it("글자 설정을 save/restore 로 가둔다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06" });
    expect(calls.filter((c) => c === "save")).toHaveLength(1);
    expect(calls.at(-1)).toBe("restore");
  });

  it("영상이 커도 글자가 무한정 커지지 않는다", () => {
    const huge = fakeCtx(7680, 4320);
    drawFrame(huge.ctx as never, src, { date: "2015-06", caption: "기록" });
    const sizes = huge.fonts.map((f) => Number(f.match(/(\d+(?:\.\d+)?)px/)![1]));
    // 가장 큰 글자(날짜)도 상한을 넘지 않는다
    expect(Math.max(...sizes)).toBeLessThanOrEqual(56);
  });

  it("영상이 작아도 글자가 사라질 만큼 작아지지 않는다", () => {
    const small = fakeCtx(320, 180);
    drawFrame(small.ctx as never, src, { date: "2015-06", caption: "기록" });
    const sizes = small.fonts.map((f) => Number(f.match(/(\d+(?:\.\d+)?)px/)![1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
  });
});

describe("captionLimit", () => {
  it("폭이 넓을수록 더 많이 쓸 수 있다", () => {
    expect(captionLimit(1920, 1080)).toBeGreaterThan(captionLimit(640, 360));
  });

  // 아주 좁은 영상에서도 한 마디는 쓸 수 있어야 한다
  it("최소 10자는 보장한다", () => {
    expect(captionLimit(120, 80)).toBeGreaterThanOrEqual(10);
  });

  it("가로로 넘치지 않을 만큼만 허용한다", () => {
    const w = 1280;
    const limit = captionLimit(w, 720);
    // 상한만큼 채워도 대략적인 글자폭 합이 영상 폭 안에 든다
    const capSize = Math.min(24, Math.max(12, 720 * 0.026));
    expect(limit * capSize * 0.6).toBeLessThanOrEqual(w);
  });
});

describe("재생 설정 줄", () => {
  it("맨 아래에 둔다 — 사용자 문구보다 아래", () => {
    const { ctx, calls } = fakeCtx(1000, 600);
    drawFrame(ctx as never, src, {
      date: "2015-06",
      caption: "나의 기록",
      settings: "재생속도 1.0x / 꼬리길이 3일",
    });
    const cap = at(calls, "나의 기록")!;
    const set = at(calls, "재생속도 1.0x / 꼬리길이 3일")!;
    expect(set.y).toBeGreaterThan(cap.y);
  });

  // 거들정보라 약하게 — 굵은 날짜·문구와 구분되어야 한다
  it("가는 글씨로, 버퍼 없이 그린다", () => {
    const { ctx, calls, fonts } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06", settings: "재생속도 2.0x / 꼬리길이 1일" });
    expect(fonts.some((f) => f.startsWith("400 "))).toBe(true);
    const stroked = calls.filter((c) => c.startsWith("stroke:")).map((c) => c.slice(7));
    expect(stroked).not.toContain("재생속도 2.0x / 꼬리길이 1일");
  });

  it("설정이 없으면 그리지 않는다", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx as never, src, { date: "2015-06" });
    expect(calls.filter((c) => c.startsWith("text:"))).toHaveLength(3);
  });

  // 설정 줄이 붙어도 날짜가 화면 밖으로 밀려나면 안 된다
  it("설정을 넣어도 날짜가 화면 안에 남는다", () => {
    const { ctx, calls } = fakeCtx(1000, 600);
    drawFrame(ctx as never, src, {
      date: "2015-06",
      caption: "기록",
      settings: "재생속도 1.0x / 꼬리길이 3일",
    });
    const date = at(calls, "2015-06")!;
    expect(date.y).toBeGreaterThan(0);
    expect(date.y).toBeLessThan(600);
  });
});
