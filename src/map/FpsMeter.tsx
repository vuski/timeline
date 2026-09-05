import { useEffect, useRef } from "react";
import "./FpsMeter.css";

/**
 * 초당 프레임 — 무엇이 무거운지 짐작하지 않고 재기 위해.
 *
 * 개발 중에만 켠다(import.meta.env.DEV). 배포본에서는 아무것도 그리지
 * 않으므로 번들에는 남되 화면에는 나오지 않는다.
 *
 * 값을 state 로 두지 않는다 — 그러면 이 컴포넌트가 초당 몇 번씩 리렌더를
 * 일으켜, 재려던 대상을 스스로 무겁게 만든다. DOM 을 직접 쓴다.
 */
export default function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let frames = 0;
    let last = performance.now();
    let worst = 0;
    let raf = 0;

    const tick = (now: number) => {
      frames += 1;
      const dt = now - last;
      if (dt >= 500) {
        const fps = Math.round((frames * 1000) / dt);
        // 최저값도 함께 — 평균만 보면 순간적인 끊김이 묻힌다
        worst = worst === 0 ? fps : Math.min(worst, fps);
        if (ref.current) ref.current.textContent = `${fps} fps (min ${worst})`;
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!import.meta.env.DEV) return null;
  return (
    <div
      ref={ref}
      className="fpsmeter"
      // 눌러서 최저값을 다시 재기 시작한다
      onClick={() => {
        if (ref.current) ref.current.textContent = "…";
      }}
    >
      …
    </div>
  );
}
