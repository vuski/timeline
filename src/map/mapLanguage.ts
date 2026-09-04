import type { Map as MLMap } from "maplibre-gl";

/**
 * 배경지도 글자를 사용자 언어로.
 *
 * Carto 기본 스타일은 줌 8 이하에서 `{name_en}`, 그보다 크면 `{name}`(현지
 * 표기)을 쓴다. 그래서 한국어 사용자가 넓게 보면 영어가, 확대하면 그 나라
 * 글자가 나온다 — 포르투갈을 보면 포르투갈어가 뜬다.
 *
 * 타일에는 언어별 필드가 들어 있다(name:ko, name:pt, name:ja …). 스타일이
 * 올라온 뒤 모든 symbol 레이어의 text-field 를 "사용자 언어 → 로마자 →
 * 원래 이름" 순으로 바꿔 준다.
 *
 * 스타일 JSON 을 통째로 들고 있지 않고 런타임에 고치는 이유: Carto 가
 * 스타일을 갱신해도 따라가고, 62KB 짜리 JSON 을 번들에 넣지 않아도 된다.
 */

/** 타일이 가진 언어들 — 없는 언어를 지정하면 글자가 통째로 빈다 */
const SUPPORTED = new Set([
  "am", "ar", "az", "be", "bg", "br", "bs", "ca", "co", "cs", "cy", "da", "de",
  "el", "en", "eo", "es", "et", "eu", "fi", "fr", "fy", "ga", "gd", "he", "hr",
  "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "kn", "ko", "ku", "la", "lb",
  "lt", "lv", "mk", "ml", "mt", "nl", "no", "oc", "pl", "pt", "rm", "ro", "ru",
  "sk", "sl", "sq", "sr", "sv", "th", "tr", "uk", "zh",
]);

/** "ko-KR" → "ko". 타일에 없는 언어면 null */
export function tileLanguage(tag: string | undefined): string | null {
  const base = (tag ?? "").toLowerCase().split("-")[0];
  return SUPPORTED.has(base) ? base : null;
}

/** 브라우저가 선호하는 언어 중 타일이 가진 첫 번째 */
export function preferredLanguage(
  langs: readonly string[] = typeof navigator !== "undefined"
    ? (navigator.languages ?? [navigator.language])
    : [],
): string | null {
  for (const l of langs) {
    const t = tileLanguage(l);
    if (t) return t;
  }
  return null;
}

/**
 * 스타일의 모든 글자 레이어를 그 언어로 바꾼다.
 *
 * `coalesce` 로 세 단계 대비를 둔다 — 그 언어 이름이 없는 곳(작은 마을 등)
 * 에서 글자가 사라지면 안 된다. 로마자(name:latin)를 두 번째로 두는 이유는
 * 원래 이름이 읽을 수 없는 문자일 때가 많아서다.
 */
export function applyMapLanguage(map: MLMap, lang: string | null): void {
  if (!lang) return;
  const style = map.getStyle();
  if (!style?.layers) return;
  const field = [
    "coalesce",
    ["get", `name:${lang}`],
    ["get", "name:latin"],
    ["get", "name"],
  ];
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const cur = (layer as { layout?: { "text-field"?: unknown } }).layout?.["text-field"];
    if (cur === undefined) continue;
    // 주소 번지 등 이름이 아닌 글자는 건드리지 않는다
    if (typeof cur === "string" && !cur.includes("name")) continue;
    try {
      map.setLayoutProperty(layer.id, "text-field", field);
    } catch {
      // 레이어 하나가 실패해도 나머지는 계속 바꾼다
    }
  }
}

/**
 * 배경지도의 글자를 켜고 끈다.
 *
 * 궤적이 빽빽한 곳에서는 지명이 데이터를 가린다. 레이어를 지우지 않고
 * visibility 만 바꾸는 이유는 되돌릴 때 스타일을 다시 받지 않기 위해서다.
 *
 * text-field 가 있는 symbol 레이어만 건드린다 — symbol 중에는 글자 없이
 * 아이콘만 그리는 것(공항 기호 등)이 섞여 있어, 전부 끄면 기호까지 사라진다.
 */
export function applyMapLabels(map: MLMap, show: boolean): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const layout = (layer as { layout?: { "text-field"?: unknown } }).layout;
    if (layout?.["text-field"] === undefined) continue;
    try {
      map.setLayoutProperty(layer.id, "visibility", show ? "visible" : "none");
    } catch {
      // 레이어 하나가 실패해도 나머지는 계속 바꾼다
    }
  }
}
