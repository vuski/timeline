/** 체류점 — semanticSegments[].visit */
export interface Visit {
  /** "v0", "v1", … 배열 인덱스 기반. 파싱이 결정적이므로 안정적이다 */
  id: string;
  lat: number;
  lng: number;
  /**
   * 원본 ISO — 기간 필터의 문자열 비교에 쓴다.
   *
   * 주의: 이 오프셋은 **현지 시간대가 아니다.** 내보낸 파일은 모든 시각을 계정
   * 홈 시간대로 맞춰 내보낸다(실측 62,715 세그먼트 전부 +09:00). 현지
   * 시간대는 `offsetMin` 에 따로 들어 있다.
   */
  start: string;
  end: string;
  /**
   * 그 장소의 UTC 오프셋(분) — 원본 startTimeTimezoneUtcOffsetMinutes.
   * 구글이 서머타임까지 반영해 판정한 값이다(포르투갈 2월 = 0, 여름 = 60).
   * 실측에서 visit 은 100% 이 값을 갖는다.
   */
  offsetMin?: number | null;
  /** Date.parse(start) — 정렬·애니메이션용 */
  startMs: number;
  placeId: string | null;
  semanticType: string | null;
}

/** 이동 궤적 — timelinePath(실측) 또는 activity(start→end 직선) */
export interface Track {
  /** "t0", "t1", … */
  id: string;
  /** 평탄 좌표 [lng,lat, lng,lat, …] — deck.gl 이 복사 없이 먹는다 */
  path: Float64Array;
  /** 정점별 epoch ms — path.length / 2 개 */
  times: Float64Array;
  startMs: number;
  endMs: number;
  /** 원본 ISO — 기간 필터의 문자열 비교용 */
  start: string;
  /** "path" = 실측 GPS, "activity" = start→end 를 이은 직선 */
  kind: "path" | "activity";
  /**
   * 이 조각이 지난 곳의 UTC 오프셋(분).
   *
   * timelinePath 세그먼트에는 이 값이 없다(실측 21,569 개 전부 없음).
   * 조각은 두 체류점 사이에 놓이므로 **출발지 체류점의 오프셋**을
   * 물려받는다 — 비행 중 구간은 애매하지만 출발지 기준이 감각에 맞다.
   * 파생 선(호·연결선)에는 없다.
   */
  offsetMin?: number | null;
  /**
   * 이 조각이 나온 원본 timelinePath 블록의 시간 (세그먼트 startTime~endTime).
   * 블록은 2시간 고정이고 파서가 체류 시간을 잘라내 여러 조각으로 나누지만,
   * 삭제는 블록 단위다 — 지운 점과 겹치는 블록의 조각은 전부 지운다.
   * 파생 선(호·연결선)에는 없다.
   */
  blockStartMs?: number;
  blockEndMs?: number;
}

export interface TimelineData {
  visits: Visit[];
  tracks: Track[];
  /** "YYYY-MM-DD" */
  spanFrom: string;
  spanTo: string;
  /** tracks 전체 정점 수 — 예산 표시의 재료 (설계 §2.2) */
  totalVerts: number;
  /** "2024" → 19179 */
  vertsByYear: Record<string, number>;
  /**
   * 이동 구간 [시작ms, 끝ms] — activity 세그먼트의 시각만, 시작 오름차순.
   *
   * 좌표는 담지 않는다. 파서가 activity 를 그리지 않는 이유는 좌표가
   * 출발·도착 두 개뿐이라 실측 궤적과 겹치기 때문인데(51%), 시간을 세는
   * 데는 그 구간이 있어야 이동과 공백이 갈린다.
   */
  moveSpans: Array<[number, number]>;
}
