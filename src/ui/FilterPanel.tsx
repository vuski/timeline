import { useState } from "react";
import { useT } from "../i18n";
import type { TimelineStore } from "../state/useTimelineStore";
import DateRangeInput from "./DateRangeInput";
import Histogram from "./Histogram";
import "./FilterPanel.css";

export default function FilterPanel({ store }: { store: TimelineStore }) {
  const { t } = useT();
  const {
    data, range, setRange, connectMode, setConnectMode,
  } = store;

  // "전체 보기" 를 누른 횟수 — 히스토그램의 확대 창까지 함께 되돌린다
  const [resetNonce, setResetNonce] = useState(0);

  /*
   * 히스토그램은 체류점으로 그린다 — 막대 높이가 체류 시간이라
   * 머문 시간이 없는 궤적으로는 셀 수 없다.
   *
   * 개수로 세던 때는 궤적이 있으면 궤적을 썼지만, 개수로는 짧은 방문
   * 여러 번과 긴 체류 하나가 구분되지 않아 기록이 통째로 빠진 시기가
   * 보이지 않았다.
   */
  const histoItems = data.visits;

  return (
    <div className="filter">
      <section>
        {/* 제목과 안내를 한 줄로 — 모바일에서 줄 하나가 아깝다.
            드래그로 구간을 고른다는 건 그래프만 보고는 알 길이 없다 */}
        <div className="filter-hrow">
          <h2 className="filter-h">{t("filter.title")}</h2>
          <p className="filter-draghint">{t("filter.dragHint")}</p>
        </div>
        <Histogram
          items={histoItems}
          range={range}
          onRange={setRange}
          spanFrom={data.spanFrom}
          spanTo={data.spanTo}
          resetNonce={resetNonce}
        />
        <DateRangeInput
          range={range}
          onRange={setRange}
          spanFrom={data.spanFrom}
          spanTo={data.spanTo}
          onReset={() => {
            setRange(null);
            setResetNonce((n) => n + 1);
          }}
        />
      </section>

      <section>
        <h2 className="filter-h">{t("filter.connect")}</h2>
        <div className="filter-modes" role="radiogroup" aria-label={t("filter.connect")}>
          <button
            role="radio"
            aria-checked={connectMode === "path"}
            className={connectMode === "path" ? "chip on" : "chip"}
            onClick={() => setConnectMode("path")}
          >
            {t("filter.connectPath")}
          </button>
          <button
            role="radio"
            aria-checked={connectMode === "arc"}
            className={connectMode === "arc" ? "chip on" : "chip"}
            onClick={() => setConnectMode("arc")}
          >
            {t("filter.connectArc")}
          </button>
        </div>
        <p className="filter-hint">
          {connectMode === "path" ? t("filter.connectPathHint") : t("filter.connectArcHint")}
        </p>
      </section>

    </div>
  );
}
