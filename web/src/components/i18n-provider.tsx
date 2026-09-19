"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, tFor, type Locale, type T } from "@/lib/i18n";

type Value = { locale: Locale; t: T };

const I18nContext = createContext<Value | null>(null);

/**
 * Holds the active language for the whole console.
 *
 * It takes the locale as a string rather than a dictionary object on purpose.
 * Both dictionaries are a few KB and ship to the client anyway, so resolving the
 * one here costs nothing — and it keeps `t` memoized on the locale alone. Had the
 * dictionary arrived as a prop, every re-render of the root layout would hand
 * down a fresh object, `t` would change identity with it, every useCallback
 * holding `t` would change, and every effect depending on one would refetch.
 */
export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const value = useMemo<Value>(() => {
    const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
    return { locale: resolved, t: tFor(resolved) };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): Value {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT and useLocale must be called inside an I18nProvider");
  return value;
}

/** The translate function for the active locale. Stable across re-renders. */
export function useT(): T {
  return useI18n().t;
}

/** The active locale, for the few places that format rather than translate. */
export function useLocale(): Locale {
  return useI18n().locale;
}
