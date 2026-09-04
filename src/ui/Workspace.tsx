import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer } from "@deck.gl/core";
import type { Map as MLMap } from "maplibre-gl";
import MapView from "../map/MapView";
import {
  ArrowToggle, ColorControl, LabelToggle, WidthControl, ZAxisSlider,
} from "../map/MapWidgets";
import { zMetersPerSecond, zSpanMeters } from "../map/zscale";
import { LABEL_MAX, buildLayers, labelTargets } from "../map/layers";
import { trackTimeRange } from "../data/rows";
import { aggregateStays, displayZoom, formatStayLong } from "../data/tiles";
import { formatAt, offsetLabel } from "../data/timezone";
import { anchorsOf } from "../data/connect";
import { boundsOf, visitsIn, type LngLat, type SelectMode } from "../data/select";
import { useTimelineStore } from "../state/useTimelineStore";
import { usePlayback } from "../play/usePlayback";
import {
  defaultSpeed, formatDuration, formatSeconds, formatStampYM, loopSeconds,
} from "../play/timeMapping";
import PlayControls from "../play/PlayControls";
import RecordSheet from "../share/RecordSheet";
import ShareSheet from "../share/ShareSheet";
import { canRecord } from "../share/record";
import { useRecorder } from "../play/useRecorder";
import FilterPanel from "./FilterPanel";
import TrackList from "./TrackList";
import SelectBar from "./SelectBar";
import { useT, type TPath } from "../i18n";
import { track } from "../analytics";
import type { TimelineData, Track, Visit } from "../types";
import "./Workspace.css";

interface Props {
  data: TimelineData;
  onReload: () => void;
}


/*
 * 도구 아이콘 — 16px 스트로크 SVG. MapWidgets 의 아이콘과 같은 규격이라
 * 나란히 놓아도 굵기·크기가 어긋나지 않는다.
 */
const IconSelect = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 2.5h3M10.5 2.5h3M2.5 13.5h3M10.5 13.5h3M2.5 2.5v3M13.5 2.5v3M2.5 10.5v3M13.5 10.5v3" />
  </svg>
);

const IconUndo = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8a5 5 0 1 1 1.6 3.7" />
    <path d="M2.5 4.5v3h3" />
  </svg>
);

const IconRecord = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" />
    <path d="M10.5 7l4-2.2v6.4L10.5 9z" />
  </svg>
);

/* 시간 집계 — 격자 모양이 곴 기능이다 */
const IconTiles = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="2" y="2" width="12" height="12" strokeWidth="1.4" />
    <line x1="8" y1="2" x2="8" y2="14" strokeWidth="1.2" />
    <line x1="2" y1="8" x2="14" y2="8" strokeWidth="1.2" />
    <rect x="8" y="2" width="6" height="6" fill="currentColor" stroke="none" opacity="0.55" />
  </svg>
);

const IconShare = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="3.5" r="2" />
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="12.5" r="2" />
    <path d="M5.8 7 10.2 4.5M5.8 9l4.4 2.5" />
  </svg>
);

/** 무게 등급 → 번역 키 (FilterPanel 에서 옮겨 왔다) */
const GRADE_KEY: Record<string, TPath> = {
  light: "filter.light",
  medium: "filter.medium",
  heavy: "filter.heavy",
};

export default function Workspace({ data, onReload }: Props) {
  const { t, lang, setLang } = useT();
  const store = useTimelineStore(data);
  const [selecting, setSelecting] = useState(false);
  /** 기간·연결 설정을 펼쳐 두는가 — 접으면 목록이 그만큼 높아진다 */
  const [filtersOpen, setFiltersOpen] = useState(true);
  /**
   * 지도 줄 — 체류 집계의 격자 크기를 정하는 데만 쓴다.
   *
   * 정수로만 든다 — 손가락으로 살짝 확대할 때마다 재집계하면 끊긴다.
   */
  const [mapZoom, setMapZoom] = useState(2);
  /*
   * 모바일 하단 시트 — 세 자리에 스냅한다.
   *
   * 기본은 45vh(지도가 주인공인 상태). 위로 끌면 85vh 까지 올라가
   * 목록을 넘게 보고, 아래로 끌면 손잡이와 버튼 줄만 남기고 접힌다.
   */
  const SNAPS = [0.45, 0.85] as const;
  /**
   * 접은 상태의 높이(px) — 손잡이(32) + 버튼 줄(8+28+8+테두리 1).
   * CSS 토큰을 바꾸면 이 값도 같이 손봐야 한다.
   */
  const SHEET_MIN_PX = 77;
  /** 이만큼 넘게 움직여야 드래그로 본다 — 탭의 손떨림을 걸러낸다 */
  const DRAG_SLOP_PX = 12;

  /** 지금 시트 높이(px). null 이면 CSS 기본값(45vh)을 따른다 */
  const [sheetH, setSheetH] = useState<number | null>(null);
  /**
   * 하단 시트는 모바일 폭에서만 있다.
   *
   * 끌린 높이를 인라인으로 넣기 때문에, 창을 넓혀 데스크톱이 되면 그 값이
   * 남아 옆 패널을 엉뚝한 높이로 자른다. CSS 로 끕려면 !important 가
   * 필요한데, revert 는 인라인이 아니라 브라우저 기본값으로 돌아가 모바일에서
   * 높이가 통째로 날아간다. 그래서 여기서 붙일지 말지를 정한다.
   */
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /** 끌고 있는 동안은 애니메이션을 끔다 — 손가락을 따라가야 한다 */
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);

  /** 시트가 접혀 있는가 — 본문을 숨길지 정하는 데 쓴다 */
  const sheetShut = sheetH !== null && sheetH <= SHEET_MIN_PX + 8;

  /** 가장 가까운 스냅 자리로 — 접힘까지 포함해 세 곳 */
  const snapTo = useCallback((px: number) => {
    const vh = window.innerHeight;
    const stops = [SHEET_MIN_PX, ...SNAPS.map((r) => vh * r)];
    let best = stops[0];
    for (const st of stops) {
      if (Math.abs(st - px) < Math.abs(best - px)) best = st;
    }
    setSheetH(best);
  }, []);

  /**
   * 손잡이 드래그 — 끌리는 동안은 손가락을 그대로 따르고,
   * 떼면 가장 가까운 스냅 자리로 붙는다.
   */
  const onGripDown = useCallback((e: React.PointerEvent) => {
    const startY = e.clientY;
    const startH = sheetRef.current?.getBoundingClientRect().height ?? 0;
    let moved = false;
    setDragging(true);

    /** 끌린 거리를 허용 범위 안의 높이로 */
    const heightAt = (clientY: number) =>
      Math.min(window.innerHeight * 0.9, Math.max(SHEET_MIN_PX, startH + (startY - clientY)));

    const onMove = (ev: PointerEvent) => {
      // 손가락은 탭할 때도 몇 px 씩 흔들린다. 문턱을 넘기 전에는
      // 높이를 건드리지 않아야 살짝 닿은 것만으로 창이 뛰지 않는다.
      if (!moved && Math.abs(startY - ev.clientY) < DRAG_SLOP_PX) return;
      moved = true;
      setSheetH(heightAt(ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      if (!moved) return; // 제자리에서 떼면 클릭 — onClick 이 받는다
      snapTo(heightAt(ev.clientY));
      /*
       * 끌었으면 뒤따라오는 클릭 하나를 삼킨다 — 안 그러면 드래그 끝에
       * 손잡이가 토글되어 방금 맞춘 높이가 되돌려진다.
       *
       * 반드시 스스로 풀려야 한다. 진짜 드래그는 클릭을 낳지 않는 일이
       * 많고(특히 터치), 그러면 once 리스너가 그대로 남아 있다가 사용자의
       * **다음 클릭**을 삼킨다 — 앱 전체가 두 번씩 눌러야 먹는 증상이 된다.
       */
      const stop = (c: MouseEvent) => {
        c.stopPropagation();
        clearTimeout(timer);
      };
      window.addEventListener("click", stop, { capture: true, once: true });
      const timer = window.setTimeout(() => {
        window.removeEventListener("click", stop, { capture: true });
      }, 350);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [snapTo]);

  /** 손잡이 탭 — 접햘 있으면 기본 높이로, 아니면 접는다 */
  const toggleSheet = useCallback(() => {
    setSheetH(sheetShut ? window.innerHeight * SNAPS[0] : SHEET_MIN_PX);
  }, [sheetShut]);

  const [selectMode, setSelectMode] = useState<SelectMode>("replace");
  const [sharing, setSharing] = useState(false);

  const mapRef = useRef<MLMap | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const [, bumpLayers] = useState(0);

  const {
    renderMode, glowStyle, selectedIds, visibleVisits, visibleTracks, span, zAxis, showArrows,
    showLabels, tileStay,
    baseOffset, verts, grade,
  } = store;

  /** 지도에 날짜를 다 못 찍을 때 안내 — 선택이 LABEL_MAX 를 넘은 경우 */
  const labelOverflow = useMemo(() => {
    if (selectedIds.size <= LABEL_MAX) return 0;
    const { total } = labelTargets(visibleVisits, visibleTracks, selectedIds);
    return total > LABEL_MAX ? total : 0;
  }, [selectedIds, visibleVisits, visibleTracks]);

  const spanMs = span.endMs - span.startMs;
  // 슬라이더(0~1) → 초당 미터. 구간 전체가 200km 를 넘지 않는다 (zscale.ts)
  const zPerSec = useMemo(() => zMetersPerSecond(zAxis, spanMs), [zAxis, spanMs]);
  const zHeight = useMemo(() => zSpanMeters(zAxis, spanMs), [zAxis, spanMs]);

  const baseSpeed = useMemo(() => defaultSpeed(span), [span]);

  // 로드 직후 맞출 범위 — 원본 전체 기준(한 번만 쓰인다)
  const fitTo = useMemo((): [[number, number], [number, number]] | null => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const see = (lng: number, lat: number) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };
    for (const v of data.visits) see(v.lng, v.lat);
    for (const tr of data.tracks) {
      for (let i = 0; i < tr.path.length; i += 2) see(tr.path[i], tr.path[i + 1]);
    }
    if (!Number.isFinite(minLng)) return null;
    return [[minLng, minLat], [maxLng, maxLat]];
  }, [data]);

  /**
   * 재생 프레임 — 레이어를 다시 만들지 않고 **프롭만 갈아끼운다**.
   * buildLayers 를 매 프레임 부르면 정점 배열이 다시 만들어져 GPU 버퍼가
   * 매번 올라가고 60fps 가 깨진다.
   */
  /** 녹화 훅의 프레임 콜백 — playback 이 아래에서 만들어지므로 ref 로 잇는다 */
  const recFrameRef = useRef<(t: number) => void>(() => {});

  const onFrame = useCallback((time: number) => {
    recFrameRef.current(time);
    const layers = layersRef.current;
    if (layers.length === 0) return;
    let changed = false;
    const next = layers.map((l) => {
      if (l.id !== "glow-trips") return l;
      changed = true;
      return (l as Layer & { clone: (p: { currentTime: number }) => Layer })
        .clone({ currentTime: time });
    });
    if (!changed) return;
    layersRef.current = next;
    bumpLayers((n) => n + 1);
  }, []);

  const playback = usePlayback(span, onFrame);

  /**
   * 저장 = 처음부터 한 바퀴 재생하며 녹화. 재생 버튼은 녹화와 무관하다.
   * 시각화 모드 전용 — 발광 궤적이 이 앱의 결과물이다.
   */
  /*
   * 자막은 매 프레임 다시 읽힌다 — 상태가 아니라 ref 에서 직접 가져온다.
   * 재생 시각은 리렌더를 만들지 않고 ref 로만 흘러간다(설계 §4.6).
   */
  /** 녹화 설정 창을 거쳐 정해진 하단 문구 — 프레임마다 읽히므로 ref */
  const captionRef = useRef("");

  /**
   * 영상 맨 아래에 적는 재생 설정 — "1.0x · 꼬리 7개월 10일".
   *
   * 같은 궁적이도 속도·꼬리에 따라 전혀 다른 영상이 된다.
   */
  const stampSettings = useCallback(() => {
    const mult = baseSpeed > 0 ? playback.speed / baseSpeed : 1;
    const speed = mult >= 1 ? `${mult.toFixed(1)}x` : `${mult.toFixed(2)}x`;
    const trail = formatDuration(playback.trailMs, {
      year: t("play.year"),
      month: t("play.month"),
      day: t("play.day"),
      hour: t("play.hour"),
      minute: t("play.minute"),
    });
    return `${t("play.stampSpeed")} ${speed} / ${t("play.stampTrail")} ${trail}`;
  }, [baseSpeed, playback.speed, playback.trailMs, t]);

  const getStamp = useCallback(
    () => ({
      date: formatStampYM(playback.timeRef.current),
      caption: captionRef.current,
      settings: stampSettings(),
    }),
    [playback.timeRef, stampSettings],
  );

  const recorder = useRecorder(
    playback,
    () => mapRef.current?.getCanvas() ?? null,
    getStamp,
  );

  /** 녹화 설정 창 — 저장을 누르면 바로 찍지 않고 먼저 묻는다 */
  const [recSetup, setRecSetup] = useState(false);

  /** 지금 속도·구간으로 한 바퀴 도는 데 걸리는 시간 — 녹화 길이 예상 */
  const estimatedLen = formatSeconds(
    loopSeconds(span, playback.speed),
    t("record.minute"),
    t("record.second"),
  );
  recFrameRef.current = recorder.onFrame;

  /**
   * 체류 집계 — 켜져 있을 때만 계산한다.
   *
   * 보이는 점만 묶는다 — 기간을 좁히거나 점을 지우면 그대로 반영되어야
   * "지금 보는 것의 집계"가 된다.
   */
  const tiles = useMemo(
    () => (tileStay ? aggregateStays(visibleVisits, displayZoom(mapZoom)) : undefined),
    [tileStay, visibleVisits, mapZoom],
  );

  const tileLabel = useCallback(
    (minutes: number) =>
      formatStayLong(minutes, {
        hour: t("render.tileHour"),
        day: t("render.tileDay"),
        month: t("render.tileMonth"),
        year: t("render.tileYear"),
      }),
    [t],
  );

  // 레이어는 데이터·스타일·재생여부가 바뀔 때만 다시 만든다
  const layers = useMemo(() => {
    const built = buildLayers({
      visits: visibleVisits,
      tracks: visibleTracks,
      renderMode,
      glowStyle,
      selectedIds,
      timeFiltered: playback.timeFiltered,
      currentTime: playback.timeRef.current,
      trailDuration: playback.trailMs,
      timeOrigin: span.startMs,
      zMetersPerSecond: zPerSec,
      showArrows,
      tiles,
      tileLabel,
    });
    layersRef.current = built;
    return built;
  }, [
    visibleVisits, visibleTracks, renderMode, glowStyle, selectedIds,
    playback.timeFiltered, playback.trailMs, span.startMs, playback.timeRef,
    zPerSec, showArrows, tiles, tileLabel,
  ]);

  /** 목록에서 고른 것으로 지도를 옮긴다 — 한 점이면 확대, 여러 개면 맞춤 */
  const focusBounds = useCallback((b: [[number, number], [number, number]]) => {
    const map = mapRef.current;
    if (!map) return;
    const [[x0, y0], [x1, y1]] = b;
    if (x0 === x1 && y0 === y1) {
      map.flyTo({ center: [x0, y0], zoom: Math.max(map.getZoom(), 14), duration: 500 });
      return;
    }
    map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 500 });
  }, []);

  /**
   * 지도에서 점·선을 집었을 때. 편집 모드에서만 동작한다 — 시각화 모드는
   * 감상용이라 클릭이 아무것도 하지 않는다.
   */
  /**
   * 선 하나를 누르면 그 선이 잇는 **양쪽 체류점까지** 고른다.
   *
   * 선 자체는 목록에 없다(파생 연결선은 목록에서 뺀다). 점까지 골라야
   * 목록이 그 날짜로 따라간다.
   *
   * 두 종류를 모두 다룬다:
   * - 연결선(link-A-B): 잇는 두 대상의 id 가 이름에 들어 있다
   * - 실측 조각: 시간상 앞뒤 체류점을 찾는다(anchorsOf — 그리기 규칙과 공유)
   */
  const withEndpoints = useCallback(
    (id: string): string[] => {
      const visitIds = new Set(data.visits.map((v) => v.id));
      if (id.startsWith("link-")) {
        const parts = id.slice(5).split("-");
        // 잇는 대상이 조각이면 그 조각의 이웃 점까지 거슬러 올라간다
        const out = new Set<string>([id]);
        for (const part of parts) {
          if (visitIds.has(part)) out.add(part);
          else {
            const t = data.tracks.find((x) => x.id === part);
            const a = t && anchorsOf(data.visits, t);
            if (a) {
              out.add(data.visits[a[0]].id);
              out.add(data.visits[a[1]].id);
            }
          }
        }
        return [...out];
      }
      const track = data.tracks.find((t) => t.id === id);
      const anchors = track && anchorsOf(data.visits, track);
      return anchors
        ? [id, data.visits[anchors[0]].id, data.visits[anchors[1]].id]
        : [id];
    },
    [data],
  );

  const onPick = useCallback(
    (id: string | null, additive: boolean) => {
      if (id === null) {
        if (!additive) store.clearSelection();
        return;
      }
      store.select(withEndpoints(id), additive ? "add" : "replace");
    },
    [store, withEndpoints],
  );

  /**
   * 마우스를 올린 대상의 설명. 궤적은 시간 범위, 체류점은 시작 시각.
   * 편집 모드에서만 — 시각화 모드는 감상용이라 픽킹 자체를 끈다.
   */
  const getTooltip = useCallback((o: unknown) => {
    const d = o as Partial<Track> & Partial<Visit>;
    if (typeof d?.id !== "string") return null;
    if (typeof d.endMs === "number") {
      // 첫 정점의 실제 시각으로 — d.start 는 2시간 블록 경계라 조각의
      // 실제 출발과 다르다 (rows.ts trackRow 주석 참고)
      const times = d.times as Float64Array | undefined;
      const from = times && times.length > 0 ? times[0] : (d.startMs as number);
      const main = trackTimeRange(from, d.endMs, baseOffset);
      // 현지 시간대가 기준과 다르면 한 줄 더
      return typeof d.offsetMin === "number" && d.offsetMin !== baseOffset
        ? `${main}
${trackTimeRange(from, d.endMs, d.offsetMin)} ${offsetLabel(d.offsetMin)}`
        : main;
    }
    if (typeof d.startMs === "number") {
      const main = formatAt(d.startMs, baseOffset);
      return typeof d.offsetMin === "number" && d.offsetMin !== baseOffset
        ? `${main}
${formatAt(d.startMs, d.offsetMin)} ${offsetLabel(d.offsetMin)}`
        : main;
    }
    return null;
  }, [baseOffset]);

  const onRectDone = useCallback(
    (a: LngLat, b: LngLat) => {
      const bounds = boundsOf(a, b);
      // 영역 선택은 **점만** 집는다. 궤적은 상자를 스치기만 해도 걸려
      // 의도보다 훨씬 많이 잡히고, 어차피 점을 지우면 그 점에 딸린 궤적이
      // 함께 빠진다(connect.ts). 궤적 하나를 콕 집는 건 클릭으로 한다.
      const hit = visitsIn(visibleVisits, bounds);
      store.select(hit, selectMode);
    },
    [visibleVisits, selectMode, store],
  );

  return (
    <div className="ws">
      {/* data-viz — 지도 위 컨트롤을 어두운 면에 맞춰 반전할 때의 기준 */}
      <div className="ws-map" data-viz={String(renderMode)}>
        <MapView
          layers={layersRef.current.length > 0 ? layersRef.current : layers}
          dark={renderMode}
          showLabels={showLabels}
          fitTo={fitTo}
          zAxis={zAxis}
          onMapReady={(m) => {
            mapRef.current = m;
            // 체류 집계의 격자 크기를 줄에 맞춘다 — 정수가 바될 때만 다시 그린다
            m.on("zoomend", () => setMapZoom(m.getZoom()));
          }}
          // 영역 드래그 중에는 클릭 픽을 끈다 — 드래그 끝의 클릭이
          // 방금 만든 선택을 지워 버린다
          // 집계 중에는 점·궁적이 없다 — 골라낼 것도 설명할 것도 없다
          onPick={renderMode || selecting || tileStay ? undefined : onPick}
          getTooltip={renderMode || tileStay ? undefined : getTooltip}
          rectSelect={
            selecting ? { onDone: onRectDone, onCancel: () => setSelecting(false) } : undefined
          }
        />

        {/* 현재 모드를 화면 위에 늘 보여준다 — 조작 규칙이 모드마다 다르다 */}
        {/*
          * 모드 배지가 곧 전환 버튼이다. 오른쪽 아래 FAB 을 없애고 여기로
          * 합쳤다 — "지금 무슨 모드인가" 와 "바꾸기" 는 같은 자리에 있는 게
          * 자연스럽고, 지도 위 떠 있는 요소도 하나 줄어든다.
          */}
        <button
          className="ws-mode"
          data-viz={String(renderMode)}
          aria-pressed={renderMode}
          onClick={() => {
            track("mode_toggle", { to: renderMode ? "edit" : "visualize" });
            store.setRenderMode(!renderMode);
          }}
        >
          {/* 문구는 "지금 무슨 모드" 가 아니라 "누르면 무엇이 되는가" —
              테두리 색이 현재 모드를 말한다(남색 편집 / 노랑 시각화) */}
          {renderMode ? t("render.vizBadge") : t("render.editBadge")}
        </button>

        <div className="ws-tools">
          {/* 영역 선택 → 삭제 되돌리기 → 영상 저장 → 공유 순 */}
          {/*
            * 시각화 모드에서는 영역 선택이 없다(편집 전용). 다만 자리는
            * 비워 둔다 — 아이콘이 위아래로 밀리면 어느 게 무엇인지
            * 매번 다시 찾아야 한다.
            */}
          <button
            className={selecting ? "ws-tool on" : "ws-tool"}
            aria-pressed={selecting}
            aria-hidden={renderMode}
            data-hidden={String(renderMode)}
            disabled={renderMode}
            title={selecting ? t("select.exit") : t("select.start")}
            onClick={() => {
              // 선택 모드를 끄면 남은 선택도 지운다 — 선택 표시만 남고
              // 조작할 도구가 없는 상태를 만들지 않는다
              if (selecting) store.clearSelection();
              setSelecting((v) => !v);
            }}
          >
            <IconSelect />
            {selecting ? t("select.exit") : t("select.start")}
          </button>

          {/*
            * 체류 집계 — 편집 모드 전용. 점 선택 바로 아래에 둔다.
            * 시각화 모드는 발광 궁적이 주인공이라 격자가 그걸 덮으면 안 된다.
            */}
          {!renderMode && (
            <button
              className={tileStay ? "ws-tool ws-tool-accent on" : "ws-tool ws-tool-accent"}
              aria-pressed={tileStay}
              title={t("render.tileStay")}
              onClick={() => {
                if (!tileStay) track("tile_stay_on");
                store.setTileStay(!tileStay);
              }}
            >
              <IconTiles />
              {t("render.tileStay")}
            </button>
          )}

          {store.deletedIds.size > 0 && (
            <button
              className="ws-tool"
              onClick={store.restoreDeleted}
              title={t("select.restore")}
            >
              <IconUndo />
              {t("select.restore")}
            </button>
          )}

          {/* 영상 저장은 시각화 모드 전용 — 발광 궤적이 결과물이다 */}
          {renderMode && canRecord() && (
            <button
              className={
                recorder.phase === "recording"
                  ? "ws-tool ws-tool-warm on"
                  : "ws-tool ws-tool-warm"
              }
              onClick={
                recorder.phase === "idle" ? () => setRecSetup(true) : recorder.cancel
              }
              disabled={recorder.phase === "saving"}
              // 예상 길이 — 지금 속도로 한 바퀴 도는 데 걸리는 실제 시간
              title={t("record.estimate", { len: estimatedLen })}
            >
              <IconRecord />
              {t(
                recorder.phase === "recording"
                  ? "record.stop"
                  : recorder.phase === "saving"
                    ? "record.saving"
                    : "record.start",
              )}
              {recorder.phase === "idle" && (
                <span className="ws-tool-note">{estimatedLen}</span>
              )}
            </button>
          )}

          <button
            className="ws-tool"
            onClick={() => {
              track("share_open");
              setSharing(true);
            }}
            title={t("share.button")}
          >
            <IconShare />
            {t("share.button")}
          </button>

          {/* 방향 화살표는 편집 모드 전용 — 시각화 모드는 선만 그린다 */}
          {!renderMode && (
            <ArrowToggle on={showArrows} onToggle={() => store.setShowArrows(!showArrows)} />
          )}

          {/* 발광 외관은 시각화 모드에서만 의미가 있다 */}
          {renderMode && (
            <>
              <WidthControl
                scale={glowStyle.widthScale}
                onScale={(v) => store.setGlowStyle({ ...glowStyle, widthScale: v })}
              />
              <ColorControl style={glowStyle} onStyle={store.setGlowStyle} />
            </>
          )}

          {/* 배경 글자 — 두 모드 모두에서 쓴다. 궁적이 빽빽한 곳에서
              지명이 데이터를 가리면 끓다 */}
          <LabelToggle on={showLabels} onToggle={() => store.setShowLabels(!showLabels)} />
        </div>

        {/* z축(시간 높이) — 오른쪽에 세로로 세운다 */}
        {/*
          * z축은 발광 궤적을 시간순으로 쌓는 것이라 시각화 모드 전용이다.
          * 편집 모드에서는 자리만 남기고 감춘다 — 아래 위젯이 밀리지 않게.
          */}
        <div className="ws-zaxis" data-hidden={String(!renderMode)}>
          <ZAxisSlider value={zAxis} onValue={store.setZAxis} spanMeters={zHeight} />
        </div>

        {/*
          * 집계의 한계를 적어 둔다 — 숫자를 그대로 믿게 두면 안 된다.
          * 이동 중인 시간은 체류가 아니라 빠지고(실측 12.9%), 구글이 같은
          * 시간에 두 장소를 겹쳐 기록한 것은 중복으로 더해진다(실측 약 1%).
          */}
        {tileStay && !renderMode && (
          <p className="ws-labelnote" role="status">
            {t("render.tileNote")}
          </p>
        )}

        {/* 선택이 많으면 라벨을 다 찍지 못한다 — 무엇이 보이는지 알려 준다 */}
        {labelOverflow > 0 && !renderMode && (
          <p className="ws-labelnote" role="status">
            {t("list.labelCap", { n: labelOverflow, max: LABEL_MAX })}
          </p>
        )}

        {selecting && (
          <SelectBar
            store={store}
            mode={selectMode}
            onMode={setSelectMode}
            onExit={() => setSelecting(false)}
          />
        )}

        {renderMode && (
          <div className="ws-play">
            <PlayControls playback={playback} baseSpeed={baseSpeed} spanMs={spanMs} />
          </div>
        )}
      </div>

      <aside
        className="ws-panel"
        ref={sheetRef}
        data-shut={String(sheetShut)}
        data-dragging={String(dragging)}
        /* 끌린 높이가 있을 때만 인라인으로 덮는다 — 없으면 CSS 기본값(45vh) */
        style={
          isMobile && sheetH !== null ? { height: sheetH, maxHeight: "none" } : undefined
        }
      >
        {/*
          * 모바일에서 손으로 접었다 폼다 하는 손잡이. 데스크톱에서는
          * CSS 가 숨긴다 — 옆에 붙은 패널은 접을 이유가 없다.
          */}
        <button
          className="ws-grip"
          aria-label={t("app.panel")}
          aria-expanded={!sheetShut}
          onClick={toggleSheet}
          onPointerDown={onGripDown}
        >
          <span className="ws-grip-bar" />
        </button>

        {/* 위쪽은 스크롤되는 본문, 아래쪽 버튼 줄은 고정이다 */}
        <div className="ws-panel-scroll">
          {/* 요약 한 줄 — 체류·궁적 수에 정점 수와 무게 등급까지 붙인다.
              모바일에서 줄을 하나라도 줄이려고 한 데 모았다. */}
          {/*
            * 요약 줄이 곳 필터 접기 버튼이다.
            *
            * 주로 보는 건 지도와 아래 목록이다. 기간·연결 설정은 한번 잡으면
            * 자주 건드리지 않으니, 그 위를 통째로 접어 목록에 높이를 넘긴다.
            * 버튼을 따로 두지 않고 요약 줄을 쓴 건 — 줄 하나를 더 쓰지
            * 않기 위해서다. 요약은 접혀도 보여야 하므로 항상 남는다.
            */}
          <button
            className="ws-summary"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
            title={t(filtersOpen ? "app.filtersHide" : "app.filtersShow")}
          >
            <span className={filtersOpen ? "caret on" : "caret"} aria-hidden="true">
              ›
            </span>
            <span>
              {t("app.summary", { visits: visibleVisits.length, tracks: visibleTracks.length })}
            </span>
            <span className="ws-summary-verts" data-testid="verts">
              {verts.toLocaleString()} {t("filter.verts")}
            </span>
            <span data-testid="grade" className={`filter-grade ${grade}`}>
              {t(GRADE_KEY[grade])}
            </span>
          </button>
          {filtersOpen && <FilterPanel store={store} />}
          {/* 목록은 편집 모드 전용 — 시각화 모드는 화면을 지도에 내준다 */}
          {!renderMode && (
            <section className="ws-list">
              <TrackList
                store={store}
                onFocus={focusBounds}
                title={t("list.title")}
              />
            </section>
          )}
        </div>

        {/* 맨 아래 고정 — 스크롤해도 항상 보인다 */}
        <footer className="ws-panel-foot">
          <button className="ws-panel-open" onClick={onReload}>
            {t("app.reload")}
          </button>
          {/* 언어는 정사각형 두 글자로 — 누르면 가는 쪽을 적는다 */}
          <button
            className="ws-panel-lang"
            onClick={() => setLang(lang === "ko" ? "en" : "ko")}
            title={t("app.lang")}
            aria-label={t("app.lang")}
          >
            {lang === "ko" ? "EN" : "KO"}
          </button>
        </footer>
      </aside>

      {recSetup && (
        <RecordSheet
          videoWidth={mapRef.current?.getCanvas().width ?? 1280}
          videoHeight={mapRef.current?.getCanvas().height ?? 720}
          labelsOn={showLabels}
          estimate={estimatedLen}
          onClose={() => setRecSetup(false)}
          onStart={(o) => {
            // 버튼을 열어본 것이 아니라 실제로 찍기 시작한 횟수를 센다
            track("record_start", { caption: o.caption.length > 0, labels: o.mapLabels });
            captionRef.current = o.caption;
            setRecSetup(false);
            if (o.mapLabels === showLabels) {
              recorder.start();
              return;
            }
            /*
             * 지명을 끄고/켜고 바로 녹화하면 첫 프레임에 이전 상태가 찍힌다 —
             * setShowLabels 는 리렌더를 예약할 뿐이고, 실제로 지도를 고치는 건
             * MapView 의 effect 다. 한 프레임 물러난 뒤에 시작한다.
             */
            store.setShowLabels(o.mapLabels);
            requestAnimationFrame(() => recorder.start());
          }}
        />
      )}

      {sharing && <ShareSheet getMap={() => mapRef.current} onClose={() => setSharing(false)} />}
    </div>
  );
}
