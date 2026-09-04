import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 768px)";

/**
 * 모바일 폭 여부. 패널을 사이드바로 그릴지 바텀시트로 그릴지 고르는 데 쓴다.
 * CSS 로 숨기지 않고 한쪽만 렌더해야 같은 내용이 DOM 에 두 번 생기지 않는다
 * (스크린리더 중복 낭독·중복 id 방지).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
