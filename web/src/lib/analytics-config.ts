/**
 * The tracking ids the console injects into its own pages.
 *
 * These values end up inside an inline <script> that runs on every admin page,
 * carrying the session of the most privileged account in the deployment. The Go
 * API validates them on write, but this module does not trust what comes back:
 * a row written outside the application, or a future hole in the service, must
 * not be able to turn into script execution. Everything here fails closed.
 *
 * The four patterns mirror internal/service/analytics.go character for
 * character. A divergence in either direction is a bug — too loose here and the
 * injection hole reopens, too strict and analytics silently stops working.
 */

import type { AnalyticsInput } from "@/lib/api-client";
import type { MessageKey } from "@/lib/i18n";

/** The validated configuration, in the shape the snippets are built from. */
export type AnalyticsConfig = {
  ga4MeasurementId: string;
  gtmContainerId: string;
  matomoUrl: string;
  matomoSiteId: string;
};

/** GA4 measurement ids are `G-` followed by uppercase alphanumerics. */
const GA4_PATTERN = /^G-[A-Z0-9]{4,20}$/;
/** GTM container ids are `GTM-` followed by uppercase alphanumerics. */
const GTM_PATTERN = /^GTM-[A-Z0-9]{4,12}$/;
/**
 * A Matomo base URL: http(s), a host, an optional port, an optional path.
 * Deliberately excludes whitespace, quotes, backslashes, angle brackets and
 * backticks — a base URL needs none of them, and the character class is what
 * closes the injection hole rather than the escaping below.
 */
const MATOMO_URL_PATTERN =
  /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$/;
/** Matomo assigns positive integer site ids. */
const MATOMO_SITE_PATTERN = /^[1-9][0-9]{0,9}$/;

const MAX_ID_LENGTH = 64;
const MAX_URL_LENGTH = 2048;

/**
 * A URL scheme is case-insensitive but the patterns are not, so it is folded
 * before the check — pasting "HTTP://…" should not come back as a format error.
 * Only the scheme is touched, matching the Go service.
 */
function foldScheme(value: string): string {
  const idx = value.indexOf("://");
  if (idx <= 0) return value;
  return value.slice(0, idx).toLowerCase() + value.slice(idx);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Empty means "provider off"; anything else must match exactly. */
function acceptable(value: string, pattern: RegExp, maxLength: number): boolean {
  return value === "" || (value.length <= maxLength && pattern.test(value));
}

/**
 * Returns the validated configuration, or null when nothing is configured or
 * any non-empty value fails validation.
 *
 * Failing the whole configuration rather than dropping the one bad provider is
 * deliberate. The service already validates on write, so a malformed value can
 * only have arrived by bypassing the application — and in that case injecting
 * nothing is the right answer, not injecting most of it.
 */
export function parseAnalyticsConfig(payload: unknown): AnalyticsConfig | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;

  const ga4 = trimmed(raw.ga4_measurement_id);
  const gtm = trimmed(raw.gtm_container_id);
  const matomoUrl = trimmed(raw.matomo_url).replace(/\/+$/, "");
  const matomoSiteId = trimmed(raw.matomo_site_id);

  if (!acceptable(ga4, GA4_PATTERN, MAX_ID_LENGTH)) return null;
  if (!acceptable(gtm, GTM_PATTERN, MAX_ID_LENGTH)) return null;
  if (!acceptable(matomoUrl, MATOMO_URL_PATTERN, MAX_URL_LENGTH)) return null;
  if (!acceptable(matomoSiteId, MATOMO_SITE_PATTERN, MAX_ID_LENGTH)) return null;

  // A Matomo URL without a site id, or the reverse, cannot produce a tracker.
  if ((matomoUrl === "") !== (matomoSiteId === "")) return null;

  // Nothing configured: render nothing at all.
  if (ga4 === "" && gtm === "" && matomoUrl === "") return null;

  return {
    ga4MeasurementId: ga4,
    gtmContainerId: gtm,
    matomoUrl,
    matomoSiteId,
  };
}

/**
 * Checks a form submission and returns a key for the first bad field, or null
 * when the whole thing is acceptable.
 *
 * The caller translates the key, so the sentence naming the field is written in
 * the operator's language. This runs before the request, so a bad value comes
 * back as a sentence rather than a 400 carrying the service's English message.
 * It is a convenience, not the gate — the service and the render boundary both
 * check again.
 */
export function validateAnalyticsInput(input: AnalyticsInput): MessageKey | null {
  const ga4 = input.ga4_measurement_id.trim().toUpperCase();
  if (!acceptable(ga4, GA4_PATTERN, MAX_ID_LENGTH)) {
    return "settings.analytics.invalidGa4";
  }

  const gtm = input.gtm_container_id.trim().toUpperCase();
  if (!acceptable(gtm, GTM_PATTERN, MAX_ID_LENGTH)) {
    return "settings.analytics.invalidGtm";
  }

  const matomoUrl = foldScheme(input.matomo_url.trim()).replace(/\/+$/, "");
  if (!acceptable(matomoUrl, MATOMO_URL_PATTERN, MAX_URL_LENGTH)) {
    return "settings.analytics.invalidMatomoUrl";
  }

  const matomoSiteId = input.matomo_site_id.trim();
  if (matomoUrl !== "" && matomoSiteId === "") {
    return "settings.analytics.missingMatomoSiteId";
  }
  if (matomoSiteId !== "" && !acceptable(matomoSiteId, MATOMO_SITE_PATTERN, MAX_ID_LENGTH)) {
    return "settings.analytics.invalidMatomoSiteId";
  }

  return null;
}

/**
 * Encodes a value for interpolation into an inline <script>.
 *
 * `JSON.stringify` alone is not enough: it escapes quotes, backslashes and
 * control characters, but leaves `<`, `>`, `&` and the line separators alone,
 * so a value containing `</script>` closes the element and everything after it
 * is parsed as HTML. Replacing those five with \uXXXX keeps the decoded string
 * byte-identical while making the sequence inert to the HTML parser. This is
 * the same transform Next.js applies to its own inline scripts.
 */
export function jsonForScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
