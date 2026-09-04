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
const CAP_RATIO = 0.030;
const CAP_MIN = 13;
const CAP_MAX = 30;
const URL_RATIO = 0.022;
const URL_MIN = 11;
const URL_MAX = 22;

const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';

function sizeOf(ratio: number, min: number, max: number, height: number): number {
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
export function stampCanvas(source: HTMLCanvasElement, caption?: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  // 2D 컨텍스트를 못 받으면 새김을 포기한다 — 그림은 남겨야 하므로
  if (!ctx) return source;

  ctx.drawImage(source, 0, 0);
  const mid = out.width / 2;
  ctx.textAlign = "center";

  const capSize = sizeOf(CAP_RATIO, CAP_MIN, CAP_MAX, out.height);
  const urlSize = sizeOf(URL_RATIO, URL_MIN, URL_MAX, out.height);

  if (caption) {
    ctx.textBaseline = "top";
    // 양쪽 여백 5% 씩 남기고 들어갈 만큼 줄인다
    const fitted = fitSize(ctx, caption, capSize, out.width * 0.9);
    drawLine(ctx, caption, mid, fitted * 0.7, fitted);
  }

  ctx.textBaseline = "bottom";
  drawLine(ctx, SHARE_URL, mid, out.height - urlSize * 0.7, urlSize);

  return out;
}

/** @param caption 이미지 맨 위에 새길 한 줄. 비면 주소만 들어간다 */
export function captureMap(map: CapturableMap, caption?: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // 다시 그리게 한 뒤 그 프레임에서 읽는다 — 지운 직후의 빈 버퍼를 읽지 않도록
    map.triggerRepaint();
    requestAnimationFrame(() => {
      stampCanvas(map.getCanvas(), caption).toBlob((blob) => {
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
  if (typeof nav?.share !== "function" || typeof nav?.canShare !== "function") return false;
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
export async function shareImage(blob: Blob, text: string): Promise<"shared" | "unsupported"> {
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
