import { describe, expect, it, vi } from "vitest";
import { SHARE_URL, snapshotName, stampCanvas, stampNow } from "../share/capture";

/**
 * 그리기 호출을 기록하는 2D 컨텍스트 대역.
 *
 * fillText 는 그 순간의 글자 크기까지 함께 남긴다 — 크기를 줄여 맞추는
 * 동작을 검증하려면 "몇 px 로 실제로 그렸나" 를 알아야 한다.
 */
function fakeCanvas(width = 1200, height = 800) {
  const calls: string[] = [];
  const fonts: string[] = [];
  const sizeOfFont = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(fonts[fonts.length - 1] ?? "");
    return m ? Number(m[1]) : 16;
  };
  const ctx = {
    canvas: { width, height },
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    miterLimit: 0,
    set font(v: string) {
      fonts.push(v);
    },
    get font() {
      return fonts[fonts.length - 1] ?? "";
    },
    // 글자 하나를 크기의 0.6배로 친다 (한글 기준 어림)
    measureText: (t: string) => ({ width: t.length * sizeOfFont() * 0.6 }),
    drawImage: () => calls.push("draw"),
    strokeText: (t: string) => calls.push(`stroke:${t}`),
    fillText: (t: string, x: number, y: number) =>
      calls.push(`fill:${t}|${x}|${y}|${sizeOfFont()}`),
  };
  /*
   * 실제 코드는 out.width = source.width 로 크기를 덮어쓴다.
   * 대역도 그 대입을 받아 ctx.canvas 에 반영해야 실제와 같이 동작한다.
   */
  const canvas = {
    get width() {
      return ctx.canvas.width;
    },
    set width(v: number) {
      ctx.canvas.width = v;
    },
    get height() {
      return ctx.canvas.height;
    },
    set height(v: number) {
      ctx.canvas.height = v;
    },
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  vi.spyOn(document, "createElement").mockReturnValueOnce(canvas);
  return { canvas, calls, fonts };
}

const src = { width: 1200, height: 800 } as HTMLCanvasElement;

/** "fill:<글자>|x|y|size" 를 뜯는다 */
function drawn(calls: string[], text: string) {
  const hit = calls.find((c) => c.startsWith(`fill:${text}|`));
  if (!hit) return null;
  const [, x, y, size] = hit.split("|");
  return { x: Number(x), y: Number(y), size: Number(size) };
}

describe("stampCanvas", () => {
  it("주소를 항상 맨 아래에 새긴다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src);
    const url = drawn(calls, SHARE_URL)!;
    expect(url).not.toBeNull();
    expect(url.y).toBeGreaterThan(800 * 0.85);
    expect(url.x).toBe(600);
  });

  it("사용자 문구는 맨 위에 새긴다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, "나의 기록");
    const cap = drawn(calls, "나의 기록")!;
    const url = drawn(calls, SHARE_URL)!;
    expect(cap.y).toBeLessThan(800 * 0.15);
    expect(cap.y).toBeLessThan(url.y);
  });

  it("문구가 없으면 주소만 새긴다", () => {
    const { calls } = fakeCanvas();
    stampCanvas(src);
    expect(calls.filter((c) => c.startsWith("fill:"))).toHaveLength(1);
  });

  // 밝은 지도에서도 어두운 지도에서도 읽혀야 한다 — 흰 획 + 검은 글자
  it("모든 글자에 흰 버퍼를 두른다", () => {
    const { calls } = fakeCanvas();
    stampCanvas(src, "기록");
    const stroked = calls.filter((c) => c.startsWith("stroke:")).map((c) => c.slice(7));
    expect(stroked).toEqual(["기록", SHARE_URL]);
  });

  it("지도를 먼저 그리고 그 위에 글자를 올린다", () => {
    const { calls } = fakeCanvas();
    stampCanvas(src, "기록");
    expect(calls.indexOf("draw")).toBeLessThan(calls.findIndex((c) => c.startsWith("fill:")));
  });

  it("굵은 글씨로 쓴다", () => {
    const { fonts } = fakeCanvas();
    stampCanvas(src, "기록");
    expect(fonts.every((f) => f.startsWith("700 "))).toBe(true);
  });
});

describe("긴 문구", () => {
  /*
   * 세로로 긴 이미지 — 높이가 충분해야 기본 글자 크기가 바닥(CAP_MIN)에
   * 닿지 않아 줄일 여지가 생긴다. 가로는 좁게 두어 긴 글이 넘치게 한다.
   */
  const narrow = { width: 500, height: 900 } as HTMLCanvasElement;

  it("폭을 넘으면 글자를 줄인다", () => {
    const short = fakeCanvas();
    stampCanvas(narrow, "짧게");
    const a = drawn(short.calls, "짧게")!.size;

    const long = fakeCanvas();
    const text = "아주 아주 아주 아주 아주 아주 길게 쓴 문구입니다";
    stampCanvas(narrow, text);
    const b = drawn(long.calls, text)!.size;

    expect(b).toBeLessThan(a);
  });

  it("줄인 뒤에는 폭 안에 들어간다", () => {
    const { calls } = fakeCanvas();
    const text = "아주 아주 아주 아주 길게 쓴 문구입니다";
    stampCanvas(narrow, text);
    const used = drawn(calls, text)!.size;
    // 대역의 글자폭 규칙(0.6배)으로 재도 허용 폭 안
    expect(text.length * used * 0.6).toBeLessThanOrEqual(600 * 0.9);
  });

  // 짧은 글까지 덩달아 작아지면 안 된다
  it("짧으면 원래 크기 그대로", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, "기록");
    expect(drawn(calls, "기록")!.size).toBe(24);
  });

  // 아무리 길어도 읽을 수 없을 만큼 작아지지는 않는다
  it("바닥 아래로는 줄이지 않는다", () => {
    const { calls } = fakeCanvas();
    const text = "가".repeat(200);
    stampCanvas(narrow, text);
    expect(drawn(calls, text)!.size).toBeGreaterThanOrEqual(6);
  });
});

describe("파일명", () => {
  const at = new Date(2026, 8, 4, 15, 30, 12); // 2026-09-04 15:30:12

  it("이미지는 timeline_snapshot_ + 저장 시각", () => {
    expect(snapshotName(at)).toBe("timeline_snapshot_20260904_153012.png");
  });

  it("한 자리 수는 0 을 채운다", () => {
    expect(stampNow(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102_030405");
  });

  // 여러 번 저장해도 서로 덮어쓰지 않아야 한다
  it("시각이 다르면 이름도 다르다", () => {
    expect(snapshotName(new Date(2026, 8, 4, 15, 30, 12))).not.toBe(
      snapshotName(new Date(2026, 8, 4, 15, 30, 13)),
    );
  });
});
