import { headers } from "next/headers";

/**
 * The origin this request arrived on, for metadata that has to be absolute.
 *
 * It is derived from the request rather than from configuration because the
 * console does not know its own public address: PUBLIC_URL names the short-link
 * domain, which is a different host in a deployment that splits the two, and
 * NEXT_PUBLIC_* is baked in at build time, so a domain change would mean a
 * rebuild. Whatever host the visitor used is the host the page is reachable on,
 * which is exactly what a canonical URL is supposed to say.
 *
 * The gateway overwrites X-Forwarded-Host on the way through, so a client cannot
 * choose that one. It does not overwrite Host, so a client still influences the
 * result — this is a display value and must not be treated as a security
 * boundary. Nothing downstream makes a trust decision from it; the worst case is
 * a canonical link pointing at a hostname the visitor supplied.
 */
export async function requestOrigin(): Promise<string> {
  const incoming = await headers();
  // Both are lists in the general case; the first entry is the one the client
  // actually connected to.
  const host = (incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "").split(",")[0].trim();
  const proto = (incoming.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  // Validated rather than trusted: sitemap.xml interpolates this into XML
  // without escaping, so a host carrying "<" would produce a malformed document.
  // A rejected host falls back rather than failing the request — a wrong
  // canonical is a smaller problem than a page that will not render.
  if (!HOST_PATTERN.test(host)) return FALLBACK_ORIGIN;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/** A host name with an optional port, and nothing else. */
const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

const FALLBACK_ORIGIN = "http://localhost";
