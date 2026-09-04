/**
 * 지도 캔버스 녹화 — 순수 브라우저 API.
 *
 * `canvas.captureStream()` 으로 지도 캔버스의 프레임을 그대로 받아
 * `MediaRecorder` 에 흘린다. 라이브러리도 백엔드도 필요 없다. 캡쳐와 같은
 * 캔버스를 읽으므로 UI 패널은 자연히 빠지고 배경지도는 함께 담긴다.
 *
 * 형식은 브라우저가 가려 받는다. mp4 를 먼저 시도하고 안 되면 WebM 으로
 * 떨어진다 — MediaRecorder 가 보편적으로 보장하는 건 WebM 쪽이고, mp4 를
 * 강제하려면 ffmpeg.wasm(~30MB)이 필요해 이 앱 성격에 맞지 않는다.
 * 실제로 나온 형식에 맞춰 확장자를 붙인다.
 *
 * 자막(재생 시점 YYYY-MM)을 넣을 때는 한 단계를 더 거친다. 지도 캔버스는
 * WebGL 이라 2D 컨텍스트로 글자를 쓸 수 없고, HTML 로 덮은 글자는 캔버스
 * 픽셀에 없어 영상에 안 담긴다. 그래서 합성 캔버스를 하나 두고 매 프레임
 * 지도 그림과 글자를 차례로 그려, 그 캔버스를 녹화한다.
 */

import { stampNow } from "./capture";

/** 시도할 형식 — 앞에서부터 브라우저가 받아 주는 첫 번째를 쓴다 */
const CANDIDATES = [
  { mime: "video/mp4;codecs=avc1", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9", ext: "webm" },
  { mime: "video/webm;codecs=vp8", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
] as const;

/** 초당 프레임 — 60 으로 올리면 20만 정점 재생과 겹쳐 프레임이 떨어진다 */
export const RECORD_FPS = 30;

/** 비트레이트 상한(bps) — 파일이 지나치게 커지지 않게 */
const BITRATE = 8_000_000;

export interface RecordFormat {
  mime: string;
  ext: string;
}

/** 이 브라우저가 녹화를 지원하는가 — 지원 형식이 하나도 없으면 불가 */
export function pickFormat(): RecordFormat | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return { mime: c.mime, ext: c.ext };
    } catch {
      // isTypeSupported 자체가 던지는 브라우저가 있다 — 다음 후보로
    }
  }
  return null;
}

export function canRecord(): boolean {
  return pickFormat() !== null;
}

export interface Recording {
  /** 녹화를 멈추고 파일을 돌려준다. 두 번 불러도 안전하다 */
  stop: () => Promise<{ blob: Blob; ext: string }>;
}

/*
 * 자막 크기는 모두 영상 높이에 비례한다 — 4K 로 녹화하든 창을 줄여
 * 녹화하든 글자가 화면에서 차지하는 비중이 같게 보이게 하려는 것이다.
 * min/max 는 너무 작거나 우스꼴스러울 만큼 크지지 않게 막아 둔다.
 */
const TITLE = { ratio: 0.038, min: 15, max: 36 };
const REPO = { ratio: 0.022, min: 10, max: 20 };
const DATE = { ratio: 0.058, min: 22, max: 56 };
const CAPTION = { ratio: 0.026, min: 12, max: 24 };
/** 재생 설정 — 거듬정보라 더 작고 가늘게 */
const SETTINGS = { ratio: 0.018, min: 9, max: 16 };

/** 영상에 고정으로 박히는 문구 */
export const VIDEO_TITLE = "Timeline Explorer";
export const VIDEO_REPO = "github.com/vuski/timeline";

const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';

function sizeOf(spec: { ratio: number; min: number; max: number }, height: number): number {
  return Math.min(spec.max, Math.max(spec.min, height * spec.ratio));
}

/**
 * 글자 하나를 그린다.
 *
 * `buffer` 는 글자 둘레를 감싸는 검은 테두리다. 그림자로도 비슷한 효과가
 * 나지만, 밝은 궁적 위에서는 그림자가 물러져 글자가 물린다. 획을 먼저
 * 깔고 그 위에 흰 글자를 올려야 어떤 배경에서든 윤곽이 살아남는다.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  buffer: boolean,
): void {
  if (!text) return;
  ctx.font = `${weight} ${size}px ${FONT}`;
  if (buffer) {
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
}

/**
 * 하단 문구의 글자 수 상한 — 영상 폭에서 역산한다.
 *
 * 폭을 넘기면 글자가 화면 밖으로 잘려 나간다(캔버스는 줄바꿈을 모른다).
 * 평균 글자폭을 크기의 0.6배로 잡고, 양쪽 여백 10% 를 남긴다. 한글은
 * 라틴보다 넓어 이 상한이면 보수적으로 안전하다.
 */
export function captionLimit(videoWidth: number, videoHeight: number): number {
  const size = sizeOf(CAPTION, videoHeight);
  const usable = videoWidth * 0.8;
  return Math.max(10, Math.floor(usable / (size * 0.6)));
}

export interface FrameText {
  /** 재생 시점 "YYYY-MM" */
  date: string;
  /** 사용자가 하단에 새기는 문구 — 비면 안 그린다 */
  caption?: string;
  /**
   * 재생 설정 — "1.0x · 꼬리 7개월 10일".
   *
   * 같은 궁적이도 속도와 꼬리에 따라 전혀 다른 영상이 된다. 나중에
   * 영상만 보고도 어떤 설정이었는지 알 수 있게 맨 아래에 작게 적는다.
   */
  settings?: string;
}

/**
 * 한 프레임 합성 — 지도 그림 위에 글자를 올린다.
 *
 * 상단은 제목 → 저장소, 하단은 날짜 → 사용자 문구 순으로 둔다.
 * 하단은 밑에서부터 쌓아 올린다 — 문구가 없으면 날짜가 그 자리를 대신
 * 차지해야 하므로, 위에서 내려잡으면 빈 칸이 생긴다.
 *
 * 모두 가운데 정렬 — 영상은 비율이 제각각이라 모서리 기준은 위험하다.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  text: FrameText,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  const mid = width / 2;
  ctx.save();
  ctx.textAlign = "center";

  const titleSize = sizeOf(TITLE, height);
  const repoSize = sizeOf(REPO, height);
  const dateSize = sizeOf(DATE, height);
  const capSize = sizeOf(CAPTION, height);

  // ── 상단: 제목 → 저장소 ──
  ctx.textBaseline = "top";
  let top = titleSize * 0.7;
  drawText(ctx, VIDEO_TITLE, mid, top, titleSize, 700, true);

  // 저장소 주소는 가늘게, 버퍼 없이 — 제목을 받치는 줄이라 약하게 둔다
  top += titleSize * 1.15;
  drawText(ctx, VIDEO_REPO, mid, top, repoSize, 400, false);

  // ── 하단: 밑에서부터 사용자 문구 → 날짜 순으로 쌓아 올린다 ──
  ctx.textBaseline = "bottom";
  let bottom = height;

  // 맨 아래 — 재생 설정. 가는 글씨로 약하게
  if (text.settings) {
    const setSize = sizeOf(SETTINGS, height);
    bottom -= setSize * 0.9;
    drawText(ctx, text.settings, mid, bottom, setSize, 400, false);
    bottom -= setSize * 0.9;
  } else {
    bottom -= capSize * 1.2;
  }

  if (text.caption) {
    // 설정 줄과 너무 붙어 보여 살짝 띄운다. 그리기만 올리고
    // bottom 은 건드리지 않는다 — 위의 날짜 자리를 그대로 두려고.
    drawText(ctx, text.caption, mid, bottom - 3, capSize, 700, false);
    bottom -= capSize * 1.6;
  }
  drawText(ctx, text.date, mid, bottom, dateSize, 700, true);

  ctx.restore();
}

/**
 * 캔버스 녹화를 시작한다.
 *
 * @throws 지원 형식이 없거나 캔버스가 스트림을 못 주면
 */
export function startRecording(
  canvas: HTMLCanvasElement,
  getStamp?: () => FrameText,
): Recording {
  const fmt = pickFormat();
  if (!fmt) throw new Error("record-unsupported");

  /*
   * 자막이 없으면 지도 캔버스를 그대로 녹화한다 — 복사 한 번을 아낀다.
   * 자막이 있으면 같은 크기의 2D 캔버스에 매 프레임 다시 그려 그쪽을 녹화한다.
   */
  let compose: number | null = null;
  let stream: MediaStream;

  if (!getStamp) {
    stream = canvas.captureStream(RECORD_FPS);
  } else {
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("record-unsupported");
    stream = off.captureStream(RECORD_FPS);
    const tick = () => {
      compose = requestAnimationFrame(tick);
      drawFrame(ctx, canvas, getStamp());
    };
    compose = requestAnimationFrame(tick);
  }
  const rec = new MediaRecorder(stream, {
    mimeType: fmt.mime,
    videoBitsPerSecond: BITRATE,
  });

  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let done: Promise<{ blob: Blob; ext: string }> | null = null;

  const stop = () => {
    if (done) return done;
    done = new Promise((resolve, reject) => {
      rec.onstop = () => {
        // 트랙을 놓아 준다 — 안 그러면 캔버스가 계속 캡쳐 대상으로 남는다
        if (compose !== null) cancelAnimationFrame(compose);
        compose = null;
        for (const t of stream.getTracks()) t.stop();
        resolve({ blob: new Blob(chunks, { type: fmt.mime }), ext: fmt.ext });
      };
      rec.onerror = () => reject(new Error("record-failed"));
      if (rec.state === "inactive") {
        rec.onstop?.(new Event("stop"));
        return;
      }
      rec.stop();
    });
    return done;
  };

  // 주기적으로 조각을 받아 둔다 — 한 번에 받으면 긴 녹화에서 메모리가 튄다
  rec.start(1000);
  return { stop };
}


/**
 * 녹화 파일을 내려받는다 — "timeline_mov_20260904_153012.mp4".
 *
 * 저장한 시각을 붙이는 이유는 여러 번 저장해도 덮어쓰지 않기 위해서다.
 */
export function downloadVideo(blob: Blob, ext: string, name = `timeline_mov_${stampNow()}`): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 클릭 직후 해제하면 다운로드가 끊기는 브라우저가 있다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
