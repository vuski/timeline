/**
 * 지도 캔버스 캡쳐와 공유.
 *
 * 전제: 지도가 `canvasContextAttributes: { preserveDrawingBuffer: true }` 로
 * 생성돼야 한다 (MapView.tsx). 없으면 toBlob 이 검은 이미지를 돌려준다 —
 * WebGL 은 기본적으로 그린 직후 버퍼를 버리기 때문이다.
 *
 * 지도 캔버스만 읽으므로 UI 패널은 자연히 빠진다 ("지도 부분만 캡쳐").
 */

interface CapturableMap {
  getCanvas: () => HTMLCanvasElement;
  triggerRepaint: () => void;
}

/** 이미지 맨 아래에 항상 박히는 주소 */
export const SHARE_URL = "https://timeline.vw-lab.com";

/*
 * 새김 글자 크기 — 이미지 높이에 비례한다. 큰 화면에서 캡쳐도 글자가
 * 화면에서 차지하는 비중이 같게 보이게 하려는 것이다.
 */
const CAP_RATIO = 0.03;
const CAP_MIN = 13;
const CAP_MAX = 30;
/*
 * 주소 — 요약보다 작아야 한다. 상한을 22 로 두면 세로로 긴 이미지에서
 * 요약(17)을 넘어서 위계가 뒤집힌다.
 */
const URL_RATIO = 0.015;
const URL_MIN = 10;
const URL_MAX = 15;
/*
 * 집계 요약.
 *
 * 상한을 26 으로 두었더니 세로로 긴 이미지(907x1250)에서 상자 글자만
 * 격자 글자(13px)의 두 배가 됐다 — 격자는 화면 배율(scale)을 그대로
 * 따르는데 여기는 이미지 높이에 비례해 커지기 때문이다. 두 기준이
 * 어긋나면 화면에서 보던 것과 다른 그림이 저장된다.
 *
 * 비율은 낮추고 상한을 격자 글자에 가깝게 내렸다.
 */
const SUM_RATIO = 0.016;
const SUM_MIN = 12;
const SUM_MAX = 17;

const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';

function sizeOf(
  ratio: number,
  min: number,
  max: number,
  height: number,
): number {
  return Math.min(max, Math.max(min, height * ratio));
}

/**
 * 글자 하나 — 흰 테두리를 깔고 그 위에 검은 글자를 올린다.
 *
 * 지도는 밝은 곳도 어두운 곳도 있으므로 한 색만으로는 어디서건 읽힐 수 없다.
 * 그림자는 밝은 바탕에서 물러져 묽개지므로 획(strokeText)을 깔아야 윤곽이 산다.
 */
/**
 * 폭 안에 들어가는 가장 큰 글자 크기를 찾는다.
 *
 * 글자 수로 잡지 않고 measureText 로 재는 이유: 한글과 라틴은 폭이
 * 두 배니 차이 나고, 같은 글자 수여도 내용에 따라 실제 폭이 달라진다.
 *
 * 너무 작아지면 읽힐 수 없으므로 바닥을 둔다 — 거기서도 넘치는 긴 글은
 * 그대로 두어 사용자가 짧게 고치도록 한다.
 */
function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  maxWidth: number,
): number {
  let s = size;
  const floor = size * 0.5;
  while (s > floor) {
    ctx.font = `700 ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 1;
  }
  return s;
}

/**
 * 집계 요약 상자 — 화면의 .ws-tilesum 과 같은 모양.
 *
 * 흰 바탕에 얇은 테두리, 가운데 정렬 두 줄. 둘째 줄(오차 안내)은 한 단
 * 작고 흐리게 — 화면과 같은 위계다.
 *
 * 글자에는 버퍼를 두르지 않는다. 흰 상자 위라 검은 글씨가 그대로 읽힌다.
 *
 * @param bottom 상자의 아래 끝
 */
/**
 * 집계 격자를 캡쳐 캔버스에 그린다.
 *
 * 격자는 SVG(map/TileOverlay)라 지도 캔버스에 담기지 않는다. 화면에서
 * 보던 그림이 저장하면 사라지므로, 같은 좌표를 받아 여기서 다시 그린다.
 *
 * TileOverlay.css 와 값을 맞춰 둔다 — 한쪽만 고치면 화면과 저장본이
 * 갈린다. 색·크기를 바꿀 일이 있으면 두 곳을 함께 본다.
 */
/*
 * 격자 색 — map/TileOverlay.css 와 같은 값이어야 한다.
 *
 * SVG 를 읽을 수 없어 여기서 손으로 다시 칠하므로, 한쪽만 고치면 화면과
 * 저장본의 색이 갈린다.
 */
const TILE_STROKE = "#0e0c8a";
const TILE_RADIUS = 6;
const TILE_INSET = 2;

/** rgba(...) 문자열의 알파에 배수를 먹인다 — 그라데이션 양 끝을 만든다 */
function shade(fill: string, mul: number): string {
  const m = /rgba?\(([^)]+)\)/.exec(fill);
  if (!m) return fill;
  const [r, g, b, a = "1"] = m[1].split(",").map((v) => v.trim());
  return `rgba(${r}, ${g}, ${b}, ${Math.min(0.92, Number(a) * mul).toFixed(3)})`;
}

/** 둥근 모서리로 경로를 그린다 — TileOverlay 의 roundedPath 와 같은 규칙 */
function tracePath(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  r: number,
): void {
  const n = pts.length;
  const back = (i: number) => shortenTo(pts[i], pts[(i - 1 + n) % n], r);
  const fwd = (i: number) => shortenTo(pts[i], pts[(i + 1) % n], r);

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const b = back(i);
    const f = fwd(i);
    if (i === 0) ctx.moveTo(b[0], b[1]);
    else ctx.lineTo(b[0], b[1]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], f[0], f[1]);
  }
  ctx.closePath();
}

function shortenTo(
  from: [number, number],
  to: [number, number],
  r: number,
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return from;
  const t = Math.min(r, len / 2) / len;
  return [from[0] + dx * t, from[1] + dy * t];
}

/** 사각형을 제 중심 쪽으로 d 만큼 줄인다 */
function insetPoints(pts: [number, number][], d: number): [number, number][] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len <= d) return [cx, cy] as [number, number];
    const t = (len - d) / len;
    return [cx + dx * t, cy + dy * t] as [number, number];
  });
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  tiles: TileShot[],
  scale: number,
): void {
  const px = (n: number) => n * scale;

  for (const t of tiles) {
    /*
     * 화면과 같은 모양으로 — 안쪽으로 물러서고 모서리를 둥글린다.
     * 값이 어긋나면 저장본만 다른 그림이 된다(TileOverlay 의 TILE_INSET,
     * TILE_RADIUS 와 같아야 한다).
     */
    const pts = insetPoints(t.points, TILE_INSET).map(
      ([x, y]) => [px(x), px(y)] as [number, number],
    );
    tracePath(ctx, pts, px(TILE_RADIUS));

    /*
     * 화면은 왼쪽 위가 밝고 오른쪽 아래가 어두운 그라데이션이다.
     * 단색으로 칠하면 판판해 보이므로 같은 결을 만든다.
     */
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const grad = ctx.createLinearGradient(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    );
    grad.addColorStop(0, shade(t.fill, 0.78));
    grad.addColorStop(1, shade(t.fill, 1.15));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = TILE_STROKE;
    ctx.lineWidth = px(1);
    ctx.stroke();
  }

  /*
   * 글자는 칸을 다 칠한 뒤에 — 이웃 칸이 글자를 덮지 않게.
   *
   * ── 화면과 다른 길을 쓴다 ──
   *
   * 화면(TileOverlay.css)은 획(stroke)으로 음영을 낸다. 지도가 움직일
   * 때마다 다시 그려야 해서 값싼 쪽을 골랐기 때문이다.
   *
   * 저장은 한 번만 그리므로 그 제약이 없다. 그래서 더 고운 그림자 쪽을
   * 쓴다 — 획은 글자 안쪽을 파고들어 얇은 글씨의 모양을 갉아먹는다.
   * CSS 주석에 남겨 둔 두 겹 그림자와 같은 값이다.
   *
   * 캔버스의 shadow* 는 한 번에 한 겹뿐이라, 겹을 바꿔 가며 두 번 그린다.
   */
  const SHADOWS: [string, number, number][] = [
    // 넓게 퍼지는 파란 기운 — 옅은 칸에서 글자를 받쳐 준다
    ["rgba(0,0,0, 0.95)", 1, 0],
    // 가까운 검정 — 획을 또렷하게 한다
    ["rgba(0, 0, 0, 0.95)", 1, 1],
  ];

  for (const t of tiles) {
    for (const [color, blur, offsetY] of SHADOWS) {
      ctx.shadowColor = color;
      ctx.shadowBlur = px(blur);
      ctx.shadowOffsetY = px(offsetY);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#fff";

      ctx.font = `700 ${px(13)}px ${FONT}`;
      ctx.fillText(t.label, px(t.cx), px(t.cy - 2));

      ctx.font = `700 ${px(10)}px ${FONT}`;
      ctx.fillText(t.share, px(t.cx), px(t.cy + 12));

      ctx.textAlign = "left";
      if (t.rank) {
        ctx.font = `800 ${px(15)}px ${FONT}`;
        ctx.fillText(t.rank, px(t.left + 5), px(t.top + 15));
      }
      if (t.area) {
        // 화면과 같이 조금 옅게(TileOverlay.css 의 opacity: 0.85)
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = `300 ${px(10)}px ${FONT}`;
        ctx.fillText(t.area, px(t.left + 5), px(t.bottom - 5));
      }
    }
  }

  // 그림자를 끄고 나간다 — 뒤에 그릴 요약 상자까지 번지면 안 된다
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawSummaryBox(
  ctx: CanvasRenderingContext2D,
  summary: StampSummary,
  mid: number,
  bottom: number,
  canvasWidth: number,
  size: number,
): void {
  const noteSize = size * 0.78;
  const padX = size * 0.9;
  const padY = size * 0.6;
  const gap = size * 0.35;

  // 상자는 화면과 같이 폭의 90% — 글자는 그 안쪽 여백까지 고려해 줄인다
  const boxW = canvasWidth * 0.9;
  const inner = boxW - padX * 2;
  /*
   * 첫 줄은 굵은 앞부분과 작은 뒷부분이 이어진다. 둘을 각각 줄이면
   * 크기 비가 흐트러지므로, 합친 폭으로 한 번에 재서 같은 비율로 줄인다.
   */
  const restRatio = 0.78;
  const head = summary.line + (summary.rest ? ` ${summary.rest}` : "");
  const lineSize = fitSize(ctx, head, size, inner);
  const restSize = lineSize * restRatio;
  const fittedNote = fitSize(ctx, summary.note, noteSize, inner);

  const boxH = padY * 2 + lineSize + gap + fittedNote;
  const left = mid - boxW / 2;
  const top = bottom - boxH;

  const r = size * 0.5;
  ctx.save();
  ctx.beginPath();
  /*
   * roundRect 는 비교적 늦게 들어온 API 다 — 없으면 각진 상자로 떨어진다.
   * 모서리가 각진 것보다 상자가 통째로 사라지는 편이 나쁘다.
   */
  if (typeof ctx.roundRect === "function")
    ctx.roundRect(left, top, boxW, boxH, r);
  else ctx.rect(left, top, boxW, boxH);
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  /*
   * 앞은 굵게, 뒤는 작게 — 화면과 같은 모양. 가운데 정렬을 유지하려면
   * 두 조각의 폭을 합쳐 왼쪽 끝을 먼저 잡아야 한다.
   */
  ctx.fillStyle = "#18181b";
  ctx.textAlign = "left";
  ctx.font = `700 ${lineSize}px ${FONT}`;
  const headW = ctx.measureText(summary.line).width;
  ctx.font = `400 ${restSize}px ${FONT}`;
  const restW = summary.rest ? ctx.measureText(` ${summary.rest}`).width : 0;
  const startX = mid - (headW + restW) / 2;

  ctx.font = `700 ${lineSize}px ${FONT}`;
  ctx.fillText(summary.line, startX, top + padY);
  if (summary.rest) {
    ctx.font = `400 ${restSize}px ${FONT}`;
    // 큰 글자의 밑선에 맞춘다 — 위쪽 정렬이면 작은 글자가 떠 보인다
    ctx.fillText(
      ` ${summary.rest}`,
      startX + headW,
      top + padY + (lineSize - restSize),
    );
  }
  ctx.textAlign = "center";

  ctx.font = `600 ${fittedNote}px ${FONT}`;
  ctx.fillStyle = "#52525b";
  ctx.fillText(summary.note, mid, top + padY + lineSize + gap);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  if (!text) return;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#000000";
  ctx.fillText(text, x, y);
}

/**
 * 지도 그림 위에 글자를 새긴다 — 위에 사용자 문구, 아래에 주소.
 *
 * 지도 캔버스는 WebGL 이라 2D 컨텍스트로 글자를 쓸 수 없다. 같은 크기의
 * 2D 캔버스에 옴겨 그리고 그쪽을 내보낸다(녹화의 record.ts 와 같은 방식).
 */
/**
 * 캡쳐에 함께 그릴 격자 한 칸 — 화면 좌표(CSS 픽셀).
 * map/TileOverlay 의 tileFrames() 가 만든다.
 */
export interface TileShot {
  points: [number, number][];
  cx: number;
  cy: number;
  left: number;
  top: number;
  bottom: number;
  fill: string;
  label: string;
  share: string;
  rank: string;
  area: string;
}

export interface StampSummary {
  /** 첫 줄 앞부분 — "총 12년 4개월 중 체류 …". 굵게 */
  line: string;
  /** 같은 줄 뒷부분 — "기타 …". 작게, 같은 색 */
  rest: string;
  /** 둘째 줄 — 오차 안내. 화면과 같은 문장 */
  note: string;
}

export function stampCanvas(
  source: HTMLCanvasElement,
  caption?: string,
  summary?: StampSummary,
  tiles?: TileShot[],
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  // 2D 컨텍스트를 못 받으면 새김을 포기한다 — 그림은 남겨야 하므로
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);

  /*
   * 격자는 SVG 라 지도 캔버스에 없다 — 여기서 다시 그린다.
   *
   * 좌표는 CSS 픽셀인데 캔버스는 기기 배율만큼 크다(레티나면 2배).
   * 그 비를 곱해 줘야 자리가 맞는다.
   */
  if (tiles && tiles.length > 0) {
    const scale = source.width / (source.clientWidth || source.width);
    drawTiles(ctx, tiles, scale);
  }

  const mid = out.width / 2;
  ctx.textAlign = "center";

  const capSize = sizeOf(CAP_RATIO, CAP_MIN, CAP_MAX, out.height);
  const urlSize = sizeOf(URL_RATIO, URL_MIN, URL_MAX, out.height);
  const sumSize = sizeOf(SUM_RATIO, SUM_MIN, SUM_MAX, out.height);

  if (caption) {
    ctx.textBaseline = "top";
    // 양쪽 여백 5% 씩 남기고 들어갈 만큼 줄인다
    const fitted = fitSize(ctx, caption, capSize, out.width * 0.9);
    drawLine(ctx, caption, mid, fitted * 0.7, fitted);
  }

  ctx.textBaseline = "bottom";
  const urlY = out.height - urlSize * 0.7;
  drawLine(ctx, SHARE_URL, mid, urlY, urlSize);

  /*
   * 집계 요약은 주소 바로 위에 — 격자에 적힌 비율이 무엇에 대한
   * 비율인지 밝히는 줄이라, 그 숫자와 함께 남아야 뜻이 산다.
   *
   * 화면의 요약 상자(.ws-tilesum)와 같은 모양으로 그린다. 글자만
   * 얹으면 지도 위에서 읽히지 않고, 무엇보다 화면에서 본 것과 다른
   * 그림이 저장되면 그것대로 당황스럽다.
   */
  if (summary) {
    drawSummaryBox(ctx, summary, mid, urlY - urlSize * 1.4, out.width, sumSize);
  }

  return out;
}

/**
 * @param caption 이미지 맨 위에 새길 한 줄. 비면 주소만 들어간다
 * @param summary 아래 주소 위에 새길 집계 요약. 시간 집계 중일 때만
 */
export function captureMap(
  map: CapturableMap,
  caption?: string,
  summary?: StampSummary,
  tiles?: TileShot[],
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // 다시 그리게 한 뒤 그 프레임에서 읽는다 — 지운 직후의 빈 버퍼를 읽지 않도록
    map.triggerRepaint();
    requestAnimationFrame(() => {
      stampCanvas(map.getCanvas(), caption, summary, tiles).toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("capture-failed"));
      }, "image/png");
    });
  });
}

/**
 * 이 브라우저가 파일 공유를 할 수 있는가.
 *
 * 주의: navigator.share 는 **보안 컨텍스트**에서만 존재한다. https 이거나
 * localhost 여야 하며, 휴대폰에서 http://192.168.x.x:5173 으로 열면
 * 이 함수가 false 를 돌려준다 — 코드 문제가 아니라 브라우저 규칙이다.
 */
export function canShareFiles(files: File[]): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav?.share !== "function" || typeof nav?.canShare !== "function")
    return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * 공유 시트가 없는 이유가 "보안 컨텍스트가 아니라서" 인가.
 *
 * 휴대폰에서 LAN 주소로 개발 서버를 열 때 생긴다. 사용자에게
 * "이 기기는 공유를 지원하지 않음" 이 아니라 이유를 알려 주기 위해 구분한다.
 */
export function blockedByInsecureContext(): boolean {
  if (typeof window === "undefined") return false;
  return !window.isSecureContext && typeof navigator.share !== "function";
}

/**
 * 네이티브 공유 시트 — 카카오톡·라인·인스타그램·X·페이스북을 한 번에
 * 덤는다. SDK 도 앱 키도 백엔드도 필요 없고 이미지까지 그대로 넘어간다.
 *
 * 어느 앱으로 보낼지는 OS 가 묻는다 — 앱별 버튼을 따로 두는 것보다
 * 확실하다. 웹 인텐트는 이미지를 못 붙이고, 카카오는 앱 키까지 요구한다.
 *
 * @returns "shared" — 시트가 떴다(사용자가 닫은 것도 포함).
 *          "unsupported" — 이 브라우저는 파일 공유를 못 한다. 부른 쪽이
 *          대체 길(웹 인텐트·저장)로 내려가야 한다.
 */
export async function shareImage(
  blob: Blob,
  text: string,
): Promise<"shared" | "unsupported"> {
  const file = new File([blob], "timeline.png", { type: "image/png" });
  if (!canShareFiles([file])) return "unsupported";
  try {
    await (navigator as Navigator).share({ files: [file], text });
    return "shared";
  } catch (err) {
    // 사용자가 시트를 닫은 것은 실패가 아니다 — 조용히 끝낸다
    if ((err as DOMException)?.name === "AbortError") return "shared";
    // 그 밖의 실패는 대체 길로 내려보낸다
    return "unsupported";
  }
}

/** "20260904_153012" — 파일명에 쓸 저장 시각(현지) */
export function stampNow(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/** 저장할 이미지의 기본 파일명 — "timeline_snapshot_20260904_153012.png" */
export function snapshotName(now = new Date()): string {
  return `timeline_snapshot_${stampNow(now)}.png`;
}

export function downloadImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 웹 인텐트를 제공하는 곳들 */
export type IntentTarget = "x" | "facebook" | "line";

/**
 * 데스크톱 보조 — 웹 인텐트로는 **이미지를 첨부할 수 없다**. 텍스트·링크만
 * 간다. 그래서 UI 는 다운로드를 1차 동선으로 두고 이것을 보조로 둔다.
 *
 * 인스타그램과 카카오톡은 여기 없다 — 둘 다 앱 키 없이는 웹에서 보낼 길이
 * 없다(카카오의 sharer 엔드포인트는 키 없이 부르면 401 을 돌려준다 — 실측).
 * 모바일의 네이티브 공유 시트로는 둘 다 갈 수 있고, 그 길은 shareImage 가 맡는다.
 * 모바일의 네이티브 공유 시트로만 갈 수 있고, 그 길은 shareImage 가 맡는다.
 */
export function intentUrl(target: IntentTarget, text: string): string {
  const encoded = encodeURIComponent(text);
  const page = encodeURIComponent(location.href);
  switch (target) {
    case "x":
      return `https://x.com/intent/post?text=${encoded}&url=${page}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${page}&quote=${encoded}`;
    case "line":
      return `https://social-plugins.line.me/lineit/share?url=${page}&text=${encoded}`;
  }
}

/**
 * 링크 복사 — 인스타그램처럼 웹 인텐트가 없는 곳으로 가는 유일한 길이다.
 *
 * clipboard API 가 막힌 환경(비보안 컨텍스트 등)을 위해 execCommand 로 떨어진다.
 */
export async function copyLink(url = location.href): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // 구형·비보안 컨텍스트 대비
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
