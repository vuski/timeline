import {
  createContext, createElement, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from "react";
import { ko, type Dict } from "./ko";
import { en } from "./en";

export type Lang = "ko" | "en";

const DICTS: Record<Lang, Dict> = { ko, en };
const STORAGE_KEY = "timeline.lang";

/** "drop.title" 처럼 2단계 점 경로 — 없는 키를 넘기면 타입 에러가 난다 */
export type TPath = {
  [K in keyof Dict & string]: {
    [L in keyof Dict[K] & string]: `${K}.${L}`;
  }[keyof Dict[K] & string];
}[keyof Dict & string];

export function detectLang(langs?: readonly string[]): Lang {
  const list =
    langs ??
    (typeof navigator !== "undefined" ? (navigator.languages ?? [navigator.language]) : []);
  for (const raw of list) {
    if (raw?.toLowerCase().startsWith("ko")) return "ko";
  }
  return "en";
}

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "ko" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

interface Ctx {
  t: (path: TPath, vars?: Record<string, string | number>) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
}

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStored() ?? detectLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // 저장 실패는 무시 — 언어 전환 자체는 동작해야 한다
    }
  }, []);

  const value = useMemo<Ctx>(() => {
    const dict = DICTS[lang];
    return {
      lang,
      setLang,
      t: (path, vars) => {
        const [ns, key] = path.split(".") as [keyof Dict, string];
        let s = (dict[ns] as Record<string, string>)[key];
        if (vars) {
          for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        }
        return s;
      },
    };
  }, [lang, setLang]);

  return createElement(I18nCtx.Provider, { value }, children);
}

export function useT(): Ctx {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useT must be used inside I18nProvider");
  return ctx;
}
