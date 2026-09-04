import { useEffect, useState } from "react";
import type { Range } from "../data/range";
import { useT } from "../i18n";

/**
 * 날짜를 직접 입력해 기간을 고른다 — 히스토그램 드래그로는 특정 날짜를
 * 정확히 집기 어렵다(12년 스팬에서 1픽셀이 며칠).
 *
 * 입력하는 순간 적용된다(적용 버튼 없음). 다만 시작 > 끝인 상태는
 * 통보하지 않는다 — 사용자가 두 칸을 순서대로 고치는 중간에 잠깐
 * 뒤집히는 건 정상이고, 그때마다 지도를 비우면 방해가 된다.
 *
 * Range 는 "YYYY-MM-DDTHH:mm" 문자열이고 원본 ISO 와 접두 비교되므로
 * (설계 §4.2) 여기서도 Date 로 바꾸지 않고 문자열만 다룬다.
 */
interface Props {
  range: Range | null;
  onRange: (r: Range | null) => void;
  /** 전체 스팬 — 입력 가능한 범위의 한계이자 비어 있을 때의 기본값 */
  spanFrom: string;
  spanTo: string;
  /** "전체 보기" — 기간과 히스토그램 확대를 함께 되돌린다 */
  onReset: () => void;
}

/** "2015-06-01T00:00" → "2015-06-01" */
const toDay = (s: string) => s.slice(0, 10);

export default function DateRangeInput({
  range, onRange, spanFrom, spanTo, onReset,
}: Props) {
  const { t } = useT();
  const [from, setFrom] = useState(() => (range ? toDay(range.from) : spanFrom));
  const [to, setTo] = useState(() => (range ? toDay(range.to) : spanTo));

  // 히스토그램 드래그나 예산 제안이 구간을 바꾸면 입력칸도 따라간다
  useEffect(() => {
    setFrom(range ? toDay(range.from) : spanFrom);
    setTo(range ? toDay(range.to) : spanTo);
  }, [range, spanFrom, spanTo]);

  /** 유효한 구간이면 즉시 적용한다. 하루 전체를 포함해 끝날 23:59 까지 */
  function commit(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo || nextFrom > nextTo) return;
    onRange({ from: `${nextFrom}T00:00`, to: `${nextTo}T23:59` });
  }

  const invalid = Boolean(from && to && from > to);

  return (
    <div className="daterange">
      {/* 시작 · 전체보기 · 끝을 한 줄에 — 히스토그램 아래 날짜 표시와
          어차피 같은 값이라 따로 둘 이유가 없다 */}
      <div className="daterange-row">
        <input
          type="date"
          className="daterange-date"
          value={from}
          min={spanFrom}
          max={spanTo}
          aria-label={t("filter.from")}
          onChange={(e) => {
            setFrom(e.target.value);
            commit(e.target.value, to);
          }}
        />
        <button type="button" className="daterange-reset" onClick={onReset}>
          {t("filter.reset")}
        </button>
        <input
          type="date"
          className="daterange-date"
          value={to}
          min={spanFrom}
          max={spanTo}
          aria-label={t("filter.to")}
          onChange={(e) => {
            setTo(e.target.value);
            commit(from, e.target.value);
          }}
        />
      </div>
      {invalid && (
        <p className="daterange-error" role="alert">
          {t("filter.invalidRange")}
        </p>
      )}
    </div>
  );
}
