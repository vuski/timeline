import { useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { logScale, stayShare, type TileStay } from "../data/tiles";

/**
 * 집계 격자를 SVG 로 그린다.
 *
 * deck.gl TextLayer 를 쓰다 옮겨 왔다. 그쪽은 글리프를 아틀라스에 구워
 * 텍스처로 붙이는 방식이라, 칸이 몇 개 안 되는 이 화면에서는 손해가 컸다:
 *
 * - (fontFamily + fontSettings) 를 키로 아틀라스를 캐시하는데 fontWeight
 *   는 그 키에 없다. 레이어마다 굵기를 달리 줘도 먼저 구운 것이 이긴다.
 * - 64px 로 구워 10px 로 그리면 가는 획이 뭉개진다.
 * - ㎢ 같은 합자는 아틀라스에서 소리 없이 떨어진다.
 *
 * SVG 는 브라우저가 직접 글자를 그리므로 이 셋이 모두 없다.
 *
 * 대신 지도 캔버스 밖의 DOM 이라 캡쳐·녹화에 담기지 않는다. 그래서
 * share/capture.ts 가 이 좌표를 받아 2D 캔버스에 다시 그린다 —
 * tileFrames() 가 그 다리다.
 */

/*
 * 칸 색 — 오래 머문 곳일수록 진하다.
 *
 * deck 시절의 #476bbf 는 회색이 섞여 배경지도에 가라앉았다. SVG 로 옮겨
 * 오면서 채도를 올렸다(#3b5bdb). 그라데이션은 왼쪽 위가 밝고 오른쪽
 * 아래가 어두운 쪽으로 — 칸이 판판한 색면이 아니라 살짝 떠 보인다.
 */
const TILE_RGB = "18, 52, 222";
const TILE_ALPHA_MIN = 0.2;
const TILE_ALPHA_SPAN = 0.6;

/** 칸 모서리 반지름(px) — 캡쳐(share/capture.ts)와 같은 값을 쓴다 */
export const TILE_RADIUS = 6;

/**
 * 칸을 안쪽으로 줄이는 폭(px).
 *
 * 맞붙여 그리면 이웃한 두 칸의 테두리가 겹쳐 한 줄이 두 배로 진해진다.
 * 1px 씩 물러서면 사이에 실틈이 생겨 칸 하나하나가 또렷하게 나뉜다.
 */
export const TILE_INSET = 2;

/** 사각형을 제 중심 쪽으로 d 만큼 줄인다 */
function inset(pts: [number, number][], d: number): [number, number][] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len <= d) return [cx, cy];
    const t = (len - d) / len;
    return [cx + dx * t, cy + dy * t];
  });
}

/**
 * 꼭짓점 넷을 둥근 모서리 path 로.
 *
 * polygon 에는 rx 가 없어 path 로 그린다. 모서리마다 두 변을 따라
 * r 만큼 물러선 점을 잡고 그 사이를 이차 베지에로 잇는다.
 *
 * 칸이 아주 작을 때는 반지름을 변 길이의 절반으로 묶는다 — 그러지
 * 않으면 곡선이 서로를 넘어 모양이 뒤집힌다.
 */
export function roundedPath(pts: [number, number][], r: number): string {
  const n = pts.length;
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];

    const back = shorten(cur, prev, r);
    const fwd = shorten(cur, next, r);

    parts.push(`${i === 0 ? "M" : "L"} ${back[0]} ${back[1]}`);
    parts.push(`Q ${cur[0]} ${cur[1]} ${fwd[0]} ${fwd[1]}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** from 에서 to 쪽으로 r 만큼(변 길이의 절반을 넘지 않게) 물러선 점 */
function shorten(
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

export interface TileFrame {
  /** 화면 좌표 폴리곤 [x,y] × 4 */
  points: [number, number][];
  /** 칸 한가운데 */
  cx: number;
  cy: number;
  /** 칸의 왼쪽 위·아래 (순위·넓이 자리) */
  left: number;
  top: number;
  bottom: number;
  /** 칠 농도 0~1 — 그라데이션을 만들 때 쓴다 */
  alpha: number;
  /** 단색 칠 — 캡쳐 캔버스가 그대로 쓴다 */
  fill: string;
  label: string;
  share: string;
  rank: string;
  area: string;
}

/**
 * 칸을 화면 좌표로 옮긴다 — 그리기와 캡쳐가 같은 함수를 쓴다.
 *
 * map.project 는 기울기·회전까지 반영하므로 폴리곤 네 꼭짓점을 각각
 * 옮겨야 한다. 가운데만 옮기고 사각형을 그리면 기울인 지도에서 어긋난다.
 */
export function tileFrames(
  map: MLMap,
  tiles: TileStay[],
  opts: {
    total: number;
    label: (minutes: number) => string;
    area: (y: number, z: number) => string;
  },
): TileFrame[] {
  /*
   * 색의 기준은 컬링 **전에** 잡는다.
   *
   * 화면에 든 칸만으로 최소·최대를 구하면, 지도를 옮길 때마다 같은 칸의
   * 색이 달라진다 — 집을 화면 밖으로 밀어내면 남은 칸들이 갑자기 진해진다.
   */
  const times = tiles.map((d) => d.minutes);
  const lo = Math.min(...times);
  const hi = Math.max(...times);

  /*
   * 화면에 조금이라도 걸치는 칸만 그린다.
   *
   * 낮은 줌에서는 집계 칸이 수백 개가 되는데 대부분은 화면 밖이다.
   * 여백을 조금 두는 것은 경계에 걸친 칸의 글자가 잘려 보이지 않게
   * 하려는 것이다.
   */
  const pad = 64;
  const w = map.getContainer().clientWidth;
  const h = map.getContainer().clientHeight;

  const out: TileFrame[] = [];
  for (const d of tiles) {
    const points = d.polygon.map((p) => {
      const q = map.project(p);
      return [q.x, q.y] as [number, number];
    });
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);

    // 경계 상자가 화면과 겹치지 않으면 건너뛴다
    if (right < -pad || left > w + pad || bottom < -pad || top > h + pad)
      continue;

    const c = map.project(d.center);
    out.push({
      points,
      cx: c.x,
      cy: c.y,
      left,
      top,
      bottom,
      alpha: TILE_ALPHA_MIN + logScale(d.minutes, lo, hi) * TILE_ALPHA_SPAN,
      fill: `rgba(${TILE_RGB}, ${
        TILE_ALPHA_MIN + logScale(d.minutes, lo, hi) * TILE_ALPHA_SPAN
      })`,
      label: opts.label(d.minutes),
      share: stayShare(d.minutes, opts.total),
      rank: d.rank ? String(d.rank) : "",
      area: opts.area(d.y, d.z),
    });
  }

  return out;
}

interface Props {
  map: MLMap | null;
  tiles: TileStay[];
  total: number;
  label: (minutes: number) => string;
  area: (y: number, z: number) => string;
  /** 칸에 마우스를 얹었을 때 — 툴팁 HTML */
  tooltip?: (t: TileStay) => string | null;
}

export default function TileOverlay({
  map,
  tiles,
  total,
  label,
  area,
  tooltip,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /*
   * 마지막으로 그린 화면 좌표. 툴팁이 이걸 다시 쓴다 — 포인터가 움직일
   * 때마다 투영을 다시 하면 헛일이다. 지도가 움직이면 draw 가 갱신한다.
   */
  const framesRef = useRef<TileFrame[]>([]);

  /*
   * 지도가 움직일 때마다 다시 그린다.
   *
   * React state 로 돌리면 매 프레임 리렌더가 걸린다 — 지도를 끄는 동안
   * 초당 60 번이다. DOM 을 직접 만지는 편이 훨씬 가볍고, 여기서 만드는
   * 것은 칸 몇 개뿐이라 손으로 조립해도 부담이 없다.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!map || !svg) return;

    const draw = () => {
      const frames = tileFrames(map, tiles, { total, label, area });
      framesRef.current = frames;
      const ns = "http://www.w3.org/2000/svg";

      /*
       * DOM 을 다시 만들지 않고 자리만 옮긴다.
       *
       * 지도를 끄는 동안 바뀌는 것은 좌표뿐이다. 매 프레임 replaceChildren
       * 으로 갈아엎으면 칸 스무 개에 요소 백 개를 초당 60 번 새로 만들게
       * 되고, 그라데이션 정의까지 매번 다시 세운다 — 색은 지도가 움직여도
       * 그대로인데도 그랬다.
       *
       * 칸 수가 달라졌을 때만 뼈대를 다시 세우고, 그 외에는 속성만 쓴다.
       */
      const need = frames.length;
      let defs = svg.querySelector("defs");

      if (svg.childElementCount !== need + 1 || !defs) {
        svg.replaceChildren();
        defs = document.createElementNS(ns, "defs");
        svg.appendChild(defs);

        for (let i = 0; i < need; i++) {
          const grad = document.createElementNS(ns, "linearGradient");
          grad.setAttribute("id", `tileovl-g${i}`);
          grad.setAttribute("x1", "0");
          grad.setAttribute("y1", "0");
          grad.setAttribute("x2", "1");
          grad.setAttribute("y2", "1");
          for (const off of ["0%", "100%"]) {
            const stop = document.createElementNS(ns, "stop");
            stop.setAttribute("offset", off);
            grad.appendChild(stop);
          }
          defs.appendChild(grad);

          const g = document.createElementNS(ns, "g");
          g.setAttribute("class", "tileovl-cell");
          const poly = document.createElementNS(ns, "path");
          poly.setAttribute("class", "tileovl-poly");
          poly.setAttribute("fill", `url(#tileovl-g${i})`);
          g.appendChild(poly);
          for (const cls of [
            "tileovl-label",
            "tileovl-share",
            "tileovl-rank",
            "tileovl-area",
          ]) {
            const el = document.createElementNS(ns, "text");
            el.setAttribute("class", cls);
            el.setAttribute("text-anchor", cls.endsWith("label") || cls.endsWith("share") ? "middle" : "start");
            g.appendChild(el);
          }
          svg.appendChild(g);
        }
      }

      frames.forEach((f, i) => {
        const grad = defs!.children[i];
        const stops = grad.children;
        stops[0].setAttribute(
          "stop-color",
          `rgba(${TILE_RGB}, ${Math.min(0.92, f.alpha * 0.78).toFixed(3)})`,
        );
        stops[1].setAttribute(
          "stop-color",
          `rgba(${TILE_RGB}, ${Math.min(0.92, f.alpha * 1.15).toFixed(3)})`,
        );

        const g = svg.children[i + 1];
        (g.children[0] as SVGPathElement).setAttribute(
          "d",
          roundedPath(inset(f.points, TILE_INSET), TILE_RADIUS),
        );

        const put = (el: Element, x: number, y: number, content: string) => {
          el.setAttribute("x", String(x));
          el.setAttribute("y", String(y));
          if (el.textContent !== content) el.textContent = content;
        };
        put(g.children[1], f.cx, f.cy - 2, f.label);
        put(g.children[2], f.cx, f.cy + 12, f.share);
        put(g.children[3], f.left + 5, f.top + 15, f.rank);
        put(g.children[4], f.left + 5, f.bottom - 5, f.area);
      });
    };

    draw();
    map.on("move", draw);
    map.on("zoom", draw);
    return () => {
      map.off("move", draw);
      map.off("zoom", draw);
    };
  }, [map, tiles, total, label, area]);

  /*
   * 툴팁 — 칸 위에서 따라다닌다.
   *
   * SVG 에 이벤트를 걸 수 없다. 폴리곤이 포인터를 받으면 휠과 드래그까지
   * 삼켜 격자 위에서 지도가 죽는다(실제로 겪었다). 그래서 지도 컨테이너의
   * 포인터 위치를 받아, 그 점이 어느 칸에 드는지 좌표로 가린다.
   *
   * 칸은 화면에서 축에 나란한 사각형이므로(기울이지 않는 편집 모드 전용)
   * 경계 상자만 보면 충분하다.
   */
  useEffect(() => {
    const tip = tipRef.current;
    if (!map || !tip || !tooltip || tiles.length === 0) return;

    const container = map.getContainer();

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const frames = framesRef.current;
      let hit = -1;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const xs = f.points.map((p) => p[0]);
        const ys = f.points.map((p) => p[1]);
        if (
          x >= Math.min(...xs) &&
          x <= Math.max(...xs) &&
          y >= Math.min(...ys) &&
          y <= Math.max(...ys)
        ) {
          hit = i;
          break;
        }
      }

      const html = hit >= 0 ? tooltip(tiles[hit]) : null;
      if (!html) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
    };
    const onLeave = () => {
      tip.hidden = true;
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, [map, tiles, tooltip]);

  if (!map || tiles.length === 0) return null;

  return (
    <>
      <svg ref={svgRef} className="tileovl" />
      <div ref={tipRef} className="map-tip map-tip-rich tileovl-tip" hidden />
    </>
  );
}
