/**
 * 베이스맵 — API 키가 필요 없는 Carto 무료 스타일.
 * 탐색은 밝게(Positron), 시각화는 어둡게(Dark Matter) — 발광 궤적은
 * 어두운 바탕에서만 제대로 보인다.
 */
export const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const INITIAL_VIEW = {
  longitude: 127.0,
  latitude: 36.5,
  zoom: 6,
} as const;
