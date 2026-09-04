/**
 * 방문 통계 — Google Analytics 4.
 *
 * 측정 ID 는 소스에 박지 않고 빌드 시점의 환경변수(VITE_GA_ID)에서 읽는다.
 * 값이 없으면 스크립트를 아예 넣지 않는다 — 개발 중이나 남이 포크해 빌드할
 * 때 남의 계정으로 집계가 흘러들지 않게.
 *
 * 주의: 이 앱의 신뢰 근거는 "위치 데이터가 브라우저 밖으로 나가지 않는다"는
 * 것이다(설계 §2). 그래서 여기로는 **어떤 좌표·시각·파일 내용도 보내지
 * 않는다.** 버튼을 눌렀다는 사실만 센다.
 */

/*
 * 모듈 로드 시점에 상수로 굳히지 않고 부를 때마다 읽는다.
 * 빌드하면 어차피 값이 박히지만, 이렇게 두면 테스트에서 꺼보며
 * "ID 가 없을 때 정말 안 보내는지"를 확인할 수 있다.
 */
function gaId(): string | undefined {
  const v = import.meta.env.VITE_GA_ID;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

/** 측정 ID 가 있고 브라우저일 때만 켠다 */
export function analyticsEnabled(): boolean {
  return gaId() !== undefined && typeof window !== "undefined";
}

/**
 * gtag 스크립트를 붙인다 — 앱이 뜰 때 한 번.
 *
 * 실패해도 앱은 그대로 돌아가야 한다. 통계는 부수적인 것이고, 광고 차단기가
 * 이 스크립트를 막는 건 흔한 일이다.
 */
export function initAnalytics(): void {
  if (!analyticsEnabled()) return;
  if (window.gtag) return; // 이미 붙었다

  const id = gaId();
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  /*
   * 구글 공식 스니펫은 `function gtag(){dataLayer.push(arguments)}` 다.
   * arguments 는 배열이 아니라 유사배열({0:…,1:…,length:n})이고, gtag.js 는
   * 그 모양을 그대로 읽는다. 화살표 함수의 나머지 매개변수로 바꿔 진짜
   * 배열을 밀어 넣으면 태그가 항목을 알아보지 못해 조용히 버린다 —
   * 스크립트는 받아오는데 실시간에 아무것도 안 잡히던 원인이었다.
   */
  function gtag(): void {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  }
  window.gtag = gtag as unknown as Gtag;
  window.gtag("js", new Date());
  window.gtag("config", id);
}

/**
 * 이벤트 하나 — 이름과 (선택) 몇 가지 꼬리표만.
 *
 * 값에 사용자 데이터를 담지 않는다. "무엇을 눌렀나"까지가 전부다.
 */
export function track(event: string, params?: Record<string, string | number | boolean>): void {
  if (!analyticsEnabled()) return;
  window.gtag?.("event", event, params);
}
