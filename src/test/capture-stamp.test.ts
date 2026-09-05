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
    save: () => {},
    restore: () => {},
    beginPath: () => calls.push("path"),
    moveTo: (x: number, y: number) => calls.push(`moveTo:${x}|${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo:${x}|${y}`),
    closePath: () => {},
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) =>
      calls.push(`curveTo:${x}|${y}`),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    roundRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`box:${x}|${y}|${w}|${h}`),
    rect: (x: number, y: number, w: number, h: number) =>
      calls.push(`box:${x}|${y}|${w}|${h}`),
    fill: () => calls.push("boxfill"),
    stroke: () => calls.push("boxstroke"),
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

describe("stampCanvas 집계 요약", () => {
  const SUM = {
    line: "총 12년 4개월 중 체류 10년 9개월(87%)",
    rest: "기타 1년 6개월(13%, 이동 포함)",
    note: "조회 패널 상단 히스토그램에서 기록이 부족한 구간을 확인할 수 있습니다.",
  };

  /** "box:x|y|w|h" 를 뜯는다 */
  const box = (calls: string[]) => {
    const hit = calls.find((c) => c.startsWith("box:"));
    if (!hit) return null;
    const [x, y, w, h] = hit.slice("box:".length).split("|").map(Number);
    return { x, y, w, h };
  };

  /*
   * 격자에 적힌 비율이 무엇에 대한 비율인지 밝히는 줄이다. 그 숫자를
   * 담은 그림에 이 줄이 없으면 이미지를 받은 사람은 분모를 알 수 없다.
   */
  it("두 줄을 모두 새긴다 — 요약과 오차 안내", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, SUM);
    expect(drawn(calls, SUM.line)).not.toBeNull();
    expect(drawn(calls, SUM.note)).not.toBeNull();
  });

  /* 화면의 요약 상자와 같은 모양이어야 저장한 그림이 낯설지 않다 */
  it("흰 상자를 깔고 그 위에 쓴다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, SUM);
    expect(calls).toContain("boxfill");
    expect(calls).toContain("boxstroke");

    const b = box(calls)!;
    expect(b).not.toBeNull();
    // 화면과 같이 폭의 90%
    expect(b.w).toBeCloseTo(1200 * 0.9, 5);
    // 글자가 상자 안에 든다
    expect(drawn(calls, SUM.line)!.y).toBeGreaterThanOrEqual(b.y);
    expect(drawn(calls, SUM.note)!.y).toBeLessThan(b.y + b.h);
  });

  it("주소 위에, 화면 아래쪽에 놓는다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, SUM);
    const b = box(calls)!;
    const url = drawn(calls, SHARE_URL)!;
    expect(b.y + b.h).toBeLessThanOrEqual(url.y);
    expect(b.y).toBeGreaterThan(800 * 0.6);
  });

  /* 오차 안내는 화면과 같은 위계 — 한 단 작게 */
  it("오차 안내를 요약보다 작게 쓴다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, SUM);
    expect(drawn(calls, SUM.note)!.size).toBeLessThan(drawn(calls, SUM.line)!.size);
  });

  /* 앞은 굵게, 뒤는 작게 — 화면과 같은 모양이어야 낯설지 않다 */
  it("뒷부분을 같은 줄에 작게 새긴다", () => {
    const { calls } = fakeCanvas(1600, 900);
    stampCanvas({ width: 1600, height: 900 } as HTMLCanvasElement, undefined, SUM);
    const head = drawn(calls, SUM.line)!;
    const rest = drawn(calls, ` ${SUM.rest}`)!;
    expect(rest).not.toBeNull();
    // 같은 줄 — 밑선을 맞추므로 y 는 다르지만 한 줄 안에 든다
    expect(Math.abs(rest.y - head.y)).toBeLessThan(head.size);
    expect(rest.size).toBeLessThan(head.size);
    // 앞부분보다 오른쪽에서 시작한다
    expect(rest.x).toBeGreaterThan(head.x);
  });

  it("요약이 없으면 상자도 글자도 넣지 않는다", () => {
    const { calls } = fakeCanvas();
    stampCanvas(src);
    expect(calls).not.toContain("boxfill");
    expect(calls.filter((c) => c.startsWith("fill:"))).toHaveLength(1);
  });

  /* 사용자 문구와 함께 와도 서로 자리를 뺏지 않는다 */
  it("사용자 문구는 위, 요약은 아래에 나뉘어 들어간다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, "나의 기록", SUM);
    expect(drawn(calls, "나의 기록")!.y).toBeLessThan(drawn(calls, SUM.line)!.y);
  });

  /*
   * 긴 문장이라 좁은 그림에서는 넘친다.
   *
   * stampCanvas 가 out.width = source.width 로 덮어쓰므로, 폭은
   * fakeCanvas 가 아니라 source 쪽을 바꿔야 실제로 달라진다.
   */
  it("상자 안쪽 폭에 맞게 글자를 줄인다", () => {
    const sized = (w: number, h: number) => ({ width: w, height: h }) as HTMLCanvasElement;

    /*
     * 높이를 크게 잡아 글자가 상한(17)까지 오른 상태에서 견준다.
     * 낮은 높이에서는 시작 크기가 이미 작아 fitSize 의 하한(시작의 절반)에
     * 먼저 걸려, 폭을 줄여도 더 내려가지 않는다.
     */
    const wide = fakeCanvas(2000, 1400);
    stampCanvas(sized(2000, 1400), undefined, SUM);
    const big = drawn(wide.calls, SUM.line)!.size;

    const narrow = fakeCanvas(420, 1400);
    stampCanvas(sized(420, 1400), undefined, SUM);
    expect(drawn(narrow.calls, SUM.line)!.size).toBeLessThan(big);
  });
});

/*
 * 격자는 SVG(map/TileOverlay)라 지도 캔버스에 담기지 않는다. 화면에서
 * 보던 그림이 저장하면 사라지지 않게, 좌표를 받아 여기서 다시 그린다.
 * 이 테스트가 그 다리를 지킨다.
 */
describe("stampCanvas 집계 격자", () => {
  const tile = {
    points: [
      [10, 10],
      [50, 10],
      [50, 50],
      [10, 50],
    ] as [number, number][],
    cx: 30,
    cy: 30,
    left: 10,
    top: 10,
    bottom: 50,
    fill: "rgba(71, 107, 191, 0.5)",
    label: "3개월",
    share: "12.3%",
    rank: "1",
    area: "60km²",
  };

  /*
   * 좌표를 콕 집어 견주지 않는다. 칸은 안쪽으로 물러서고(TILE_INSET)
   * 모서리가 둥글어(TILE_RADIUS) 꼭짓점이 그대로 찍히지 않는다 — 값을
   * 박아 두면 모양을 다듬을 때마다 테스트가 깨진다.
   *
   * 여기서 지킬 것은 "칸이 그려졌는가" 와 "제 자리에 있는가" 다.
   */
  it("칸을 둥근 경로로 그린다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, undefined, [tile]);
    expect(calls).toContain("path");
    expect(calls.filter((c) => c.startsWith("curveTo:"))).toHaveLength(4);

    // 모든 점이 원래 사각형(10~50) 안에 든다
    const pts = calls
      .filter((c) => /^(moveTo|lineTo|curveTo):/.test(c))
      .map((c) => c.split(":")[1].split("|").map(Number));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(50);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(50);
    }
  });

  it("칸 위의 글자를 모두 그린다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, undefined, [tile]);
    for (const t of ["3개월", "12.3%", "1", "60km²"]) {
      expect(drawn(calls, t), t).not.toBeNull();
    }
  });

  /* 순위와 넓이는 왼쪽 모서리, 시간과 비율은 가운데 */
  it("글자를 제자리에 놓는다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src, undefined, undefined, [tile]);
    expect(drawn(calls, "3개월")!.x).toBe(30);
    expect(drawn(calls, "1")!.x).toBe(15);
    // 넓이는 아래, 순위는 위
    expect(drawn(calls, "60km²")!.y).toBeGreaterThan(drawn(calls, "1")!.y);
  });

  it("격자가 없으면 아무것도 그리지 않는다", () => {
    const { calls } = fakeCanvas(1200, 800);
    stampCanvas(src);
    expect(calls).not.toContain("path");
  });
});
