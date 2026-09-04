/**
 * 시간 → 고도(z) 변환.
 *
 * 궤적을 시간순으로 쌓아 올려 12년치를 입체로 본다. z 는 deck.gl 이
 * 고도(미터)로 해석하므로, 구간 길이가 아무리 길어도 화면에서 다룰 수
 * 있는 높이로 눌러 담아야 한다 — 상한은 200km (사용자 지정).
 *
 * 셰이더가 z 를 시간창 판정에도 쓰기 때문에(GlowTripsLayer) 여기서
 * 계산하는 값은 "표시용 고도"이고, 시간 판정용 상대 초와는 별개 축이다.
 */

/** 아무리 긴 구간이라도 이 높이를 넘지 않는다 (미터) */
export const Z_MAX_METERS = 200_000;

/**
 * 슬라이더 값(0~1)과 구간 길이로 "초당 미터" 배율을 만든다.
 *
 * 1 일 때 구간 전체가 정확히 Z_MAX_METERS 를 채운다. 0 이면 평면.
 * 구간을 좁히면 같은 슬라이더 값에서 배율이 커지므로, 어떤 구간을 봐도
 * 화면을 채우는 높이가 나온다.
 */
export function zMetersPerSecond(sliderValue: number, spanMs: number): number {
  if (sliderValue <= 0 || spanMs <= 0) return 0;
  const spanSeconds = spanMs / 1000;
  return (Z_MAX_METERS * Math.min(1, sliderValue)) / spanSeconds;
}

/** 이 배율에서 구간 전체가 차지하는 높이(미터) — UI 표시용 */
export function zSpanMeters(sliderValue: number, spanMs: number): number {
  return zMetersPerSecond(sliderValue, spanMs) * (spanMs / 1000);
}
