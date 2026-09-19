"use client";

import { useEffect, useState, useTransition } from "react";
import { isLocale, LOCALES, type Locale } from "@/lib/i18n";
import { setLocale } from "@/lib/i18n/actions";
import { useLocale, useT } from "./i18n-provider";

/**
 * Each language is named in itself rather than translated. A reader who cannot
 * read the language the console is currently showing still has to be able to
 * find their own in the list.
 */
const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文",
};

/**
 * The control is a select whose option values are the locale codes, which are
 * the same in every language — so it can be driven by value rather than by its
 * visible text, and it stays usable from a test that does not want to know what
 * language the page is currently in.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const [pending, startTransition] = useTransition();
  // The server is the source of truth; this copy exists only so the select does
  // not snap back to the old language while the action is in flight. React
  // resets a controlled select whose value prop has not changed yet, so without
  // it the choice would visibly undo itself for a moment.
  const [selected, setSelected] = useState<Locale>(locale);
  useEffect(() => setSelected(locale), [locale]);

  return (
    <select
      className={className}
      aria-label={t("shell.language")}
      aria-busy={pending}
      value={selected}
      onChange={(event) => {
        const next = event.target.value;
        if (!isLocale(next)) return;
        setSelected(next);
        startTransition(async () => {
          await setLocale(next);
        });
      }}
    >
      {LOCALES.map((value) => (
        <option key={value} value={value}>
          {LOCALE_NAMES[value]}
        </option>
      ))}
    </select>
  );
}
