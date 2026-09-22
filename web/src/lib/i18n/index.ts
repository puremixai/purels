import { ApiError } from "@/lib/api-client";
import { en, type Dictionary, type MessageKey } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

export type { Dictionary, MessageKey };

/**
 * This module is deliberately isomorphic: it imports nothing from next/headers,
 * so a client component can use it. The server-only pieces live in server.ts and
 * the cookie write lives in actions.ts.
 */

/** The languages the console ships. Order is the order the switcher lists them. */
export const LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

/** Where an explicit choice is remembered. */
export const LOCALE_COOKIE = "purels_locale";

/**
 * English is the default. It is what an unconfigured deployment shows, and what
 * a visitor whose browser asks for something we do not ship gets.
 */
export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, Dictionary> = { en, "zh-CN": zhCN };

/**
 * Narrows an untrusted value to a locale.
 *
 * The cookie is attacker-controlled, so this stands between it and the
 * dictionary lookup: an unrecognised value would otherwise index to undefined
 * and take the first translate call down with it.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** True when the dictionaries have something to say about this key. */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export type Params = Record<string, string | number>;

export type T = (key: MessageKey, params?: Params) => string;

/**
 * Translates a value the API sends as an enum — a link status, a device, a role.
 *
 * Rows come out of the database, so an unrecognised value is rendered as the raw
 * string rather than dropped: a label that went missing because a message was
 * never added is a worse outcome than a label that reads in English.
 */
export function enumLabel(t: T, prefix: string, value: string) {
  const key = `${prefix}.${value}`;
  return hasMessage(key) ? t(key) : value;
}

/**
 * Builds the translate function for one dictionary.
 *
 * A `{one, other}` message is chosen by `count`. The comparison goes through
 * Number() because a count that arrived as a string — from a template, or from a
 * `.length` — would never equal 1 and would always read as a plural.
 *
 * An unknown `{name}` is left in place rather than blanked, so a mistake is
 * visible on the page instead of silently swallowing a value.
 */
export function createT(messages: Dictionary): T {
  return (key, params) => {
    const message = messages[key];
    const text =
      typeof message === "string"
        ? message
        : Number(params?.count) === 1
          ? message.one
          : message.other;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  };
}

/** The translate function for a locale, for code that has no hook to call. */
export function tFor(locale: Locale): T {
  return createT(dictionaries[locale]);
}

/**
 * Turns anything a request threw into text for the active locale.
 *
 * The API's own message is the last resort rather than the first. A coded error
 * gets the console's localized wording; an uncoded one — a field-level
 * validation message that names a rule the code could not — is shown exactly as
 * the API wrote it, because the console has nothing more specific to say.
 *
 * `overrides` lets a page replace a code with wording of its own, which is how
 * the settings pages say *which* permission is missing rather than just that one
 * is.
 */
export function errorText(
  t: T,
  error: unknown,
  fallback: MessageKey,
  overrides?: Partial<Record<number, MessageKey>>,
): string {
  if (error instanceof ApiError) {
    const override = overrides?.[error.status];
    if (override) return t(override);
    // Bound to a const first: hasMessage narrows a reference, not an expression,
    // so the key has to be named before the guard can narrow it.
    const key = `error.${error.code}`;
    // The status is interpolated into a few of these, and a message that renders
    // "Request failed ({status})" is worse than the code alone.
    if (error.code && hasMessage(key)) return t(key, { status: String(error.status) });
    if (error.message) return error.message;
    return t(fallback);
  }
  // A plain Error has no status and no code, so its message is all there is.
  if (error instanceof Error && error.message) return error.message;
  return t(fallback);
}
