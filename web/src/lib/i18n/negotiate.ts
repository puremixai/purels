import { DEFAULT_LOCALE, LOCALES, type Locale } from "./index";

/**
 * Picks the locale a browser asked for.
 *
 * This mirrors `preferredLang` in internal/http/handler/lang.go. The two have to
 * agree: the API renders its own `/{alias}+` preview page and the console renders
 * everything else, so a visitor whose browser asks for Chinese must not be shown
 * an English preview and then a Chinese console.
 *
 * Like its Go counterpart it is isomorphic — it imports nothing from next/headers
 * — so it can be reasoned about on its own.
 */

/**
 * Maps a tag onto a shipped locale by its primary subtag, so `zh-Hans`, `zh-TW`
 * and `zh` all reach the one Chinese dictionary, and `en-GB` reaches English.
 *
 * Deriving the match from LOCALES rather than naming the languages here means a
 * language added to the switcher is reachable from a browser header without a
 * second edit.
 */
function matchTag(tag: string): Locale | "" {
  const primary = tag.split("-")[0].toLowerCase();
  return LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === primary) ?? "";
}

/**
 * Splits one Accept-Language entry into its tag and its quality value.
 *
 * An unparsable quality yields an empty tag, which the caller reads as "not this
 * one" rather than guessing at a value.
 */
function parseTag(part: string): { tag: string; quality: number } {
  const trimmed = part.trim();
  if (trimmed === "") return { tag: "", quality: 0 };
  const [tag, ...params] = trimmed.split(";");
  let quality = 1;
  for (const param of params) {
    const separator = param.indexOf("=");
    // Any parameter other than q is ignored, which is what the header allows.
    if (separator === -1) continue;
    if (param.slice(0, separator).trim().toLowerCase() !== "q") continue;
    const parsed = Number(param.slice(separator + 1).trim());
    if (!Number.isFinite(parsed)) return { tag: "", quality: 0 };
    quality = parsed;
  }
  return { tag: tag.trim(), quality };
}

/**
 * The locale to use when nothing has been chosen explicitly.
 *
 * Quality values are honoured rather than the order the tags arrived in: a client
 * is allowed to list a language it does not want first, and picking that one
 * would be worse than falling back. A quality of zero is an explicit refusal, so
 * it is skipped even when it names the only language we speak.
 */
export function preferredLocale(acceptLanguage: string | null | undefined): Locale {
  let best: Locale = DEFAULT_LOCALE;
  let bestQuality = -1;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const { tag, quality } = parseTag(part);
    if (tag === "" || quality <= 0) continue;
    const locale = matchTag(tag);
    // `<=` rather than `<` so the earlier of two equally-ranked tags wins.
    if (locale === "" || quality <= bestQuality) continue;
    best = locale;
    bestQuality = quality;
  }
  return best;
}
