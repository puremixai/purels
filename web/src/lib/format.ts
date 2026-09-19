import type { Locale } from "@/lib/i18n";

/**
 * Date and number formatting for the console.
 *
 * The locale is a parameter rather than read from context here, because these
 * are plain functions: callers pass what `useLocale()` gave them.
 *
 * A value that will not parse is returned exactly as it arrived. These strings
 * come from the API, so an unparseable one means something is wrong upstream —
 * showing the raw value keeps that visible, where "Invalid Date" would hide it.
 */

/** A full timestamp: date and time, 24-hour. */
export function formatDateTime(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { hour12: false });
}

/**
 * A timestamp without the year: month, day and time.
 *
 * Deliberately separate from `formatDateTime`. The statistics pages only ever
 * show a bounded range, so the year is noise there — but it is essential on a
 * record timestamp like an account's creation date, which is what that one is
 * for. Two names rather than one flag, so a caller has to choose on purpose.
 */
export function formatShortDateTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** A count, grouped the way the locale groups numbers. */
export function formatNumber(value: number, locale: Locale): string {
  return value.toLocaleString(locale);
}
