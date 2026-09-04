/**
 * 재생의 산술 — GL 을 모르는 순수 함수로 분리했다.
 *
 * 시간은 React state 가 아니라 ref 로 굴린다(매 프레임 리렌더 방지, 설계 §4.6).
 * 그래서 이 함수들은 상태를 갖지 않고 "현재 시각 → 다음 시각"만 계산한다.
 */

export interface Span {
  startMs: number;
  endMs: number;
}

/** 선택 구간을 이 시간(초)에 통과하도록 기본 속도를 잡는다 */
export const TARGET_SECONDS = 30;

/** 구간 길이 (0 이하면 1 — 0 나눗셈 방지) */
function lengthOf(span: Span): number {
  return Math.max(0, span.endMs - span.startMs);
}

/**
 * 기본 속도 — 구간 길이(len, 타임라인 ms) 를 TARGET_SECONDS 초에 통과하도록
 * 역산한 값(len / TARGET_SECONDS). 12년치를 실시간으로 재생하면 끝나지 않는다.
 *
 * speed 단위: 벽시계 1초당 흘려보낼 데이터 ms.
 */
export function defaultSpeed(span: Span): number {
  const len = lengthOf(span);
  return len > 0 ? len / TARGET_SECONDS : 1000;
}

/**
 * 꼬리 길이 기본값 — 구간의 5%.
 *
 * 비율로 잡아야 구간 길이와 무관하게 같은 느낌이 난다. 절대 시간으로
 * 고정하면 12년 구간에서는 점 하나로, 하루 구간에서는 구간 전체를 덮는
 * 꼬리가 된다.
 */
export const DEFAULT_TRAIL_RATIO = 0.05;

export function defaultTrailMs(span: Span): number {
  return Math.max(1000, lengthOf(span) * DEFAULT_TRAIL_RATIO);
}

/**
 * deltaMs(실제 경과 밀리초) 를 초로 환산해 speed(벽시계 1초당 데이터 ms) 를
 * 곱한 만큼 나아간다. 끝에 닿으면 처음으로 되돌아온다 — 반복 재생.
 */
export function advance(current: number, deltaMs: number, speed: number, span: Span): number {
  const len = lengthOf(span);
  if (len <= 0) return span.startMs;
  const moved = current + (deltaMs / 1000) * speed;
  const rel = (moved - span.startMs) % len;
  return span.startMs + (rel < 0 ? rel + len : rel);
}

export function progressOf(current: number, span: Span): number {
  const len = lengthOf(span);
  if (len <= 0) return 0;
  return Math.min(1, Math.max(0, (current - span.startMs) / len));
}

export function timeAtProgress(p: number, span: Span): number {
  const clamped = Math.min(1, Math.max(0, p));
  return span.startMs + lengthOf(span) * clamped;
}

/**
 * 재생 위치를 "2015. 6. 1." 처럼 현지 날짜로 적는다.
 *
 * 여기서 Date 를 쓰는 건 규칙 위반이 아니다 — 기간 필터의 문자열 비교와
 * 달리 이 값은 애니메이션용 epoch ms 이고, 표시 목적이라 브라우저 시간대로
 * 보여주는 게 오히려 자연스럽다.
 */
export function formatPlayDate(ms: number, locale: string): string {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface DurationUnits {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** 달·해의 평균 길이 — 표시용 어림이라 윤년까지 따지지 않는다 */
const MONTH = DAY * 30.44;
const YEAR = DAY * 365.25;

/**
 * 기간을 사람이 읽는 단위로 — "1년 3개월", "2개월", "12일", "3.5시간", "20분".
 *
 * 12년치를 다루므로 일 단위만으로는 감이 오지 않는다(219일 vs "7개월").
 * 큰 단위부터 고르고, 년·개월은 나머지 단위를 하나만 덧붙인다.
 */
export function formatDuration(ms: number, u: DurationUnits): string {
  if (!Number.isFinite(ms) || ms <= 0) return `0${u.minute}`;

  if (ms >= YEAR) {
    const years = Math.floor(ms / YEAR);
    const months = Math.round((ms - years * YEAR) / MONTH);
    // 12개월로 반올림되면 해를 올린다 ("1년 12개월" 방지)
    if (months >= 12) return `${years + 1}${u.year}`;
    return months > 0 ? `${years}${u.year} ${months}${u.month}` : `${years}${u.year}`;
  }

  if (ms >= MONTH) {
    const months = Math.floor(ms / MONTH);
    const days = Math.round((ms - months * MONTH) / DAY);
    return days > 0 ? `${months}${u.month} ${days}${u.day}` : `${months}${u.month}`;
  }

  if (ms >= DAY) {
    const days = ms / DAY;
    return `${days >= 10 ? Math.round(days) : days.toFixed(1)}${u.day}`;
  }

  if (ms >= HOUR) {
    const hours = ms / HOUR;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}${u.hour}`;
  }

  return `${Math.max(1, Math.round(ms / MINUTE))}${u.minute}`;
}

/**
 * 한 바퀴 재생에 걸리는 실제 시간(초) — 녹화 길이 예상에 쓴다.
 *
 * speed 는 "실제 1초당 흐르는 구간 시간(ms)" 이므로 구간 길이를 그대로
 * 나누면 된다(advance 참고).
 */
export function loopSeconds(span: Span, speed: number): number {
  const len = lengthOf(span);
  if (len <= 0 || speed <= 0) return 0;
  return len / speed;
}

/** 초 → "1분 12초" / "45초" */
export function formatSeconds(sec: number, unitMin: string, unitSec: string): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}${unitMin} ${s}${unitSec}` : `${s}${unitSec}`;
}

/**
 * 재생 위치를 "2015-06" 으로 — 녹화 영상에 새길 자막.
 *
 * 날짜까지 적으면 12년 구간을 30초에 지나갈 때 숫자가 쉴 새 없이 바뀌어
 * 읽히지 않는다. 달 단위면 눈이 따라갈 수 있다.
 *
 * 로케일 함수를 쓰지 않는 이유: 영상에 박히는 글자라 어느 브라우저에서
 * 녹화하든 같은 모양이어야 한다("2015. 6." 과 "6/2015" 가 섞이면 안 된다).
 */
export function formatStampYM(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
