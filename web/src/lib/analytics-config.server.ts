/**
 * The tracking ids every page injects, read before anybody has signed in.
 *
 * Read on the server rather than in the browser for the same reason the
 * registration flag is: a client-side read would leave the landing page, sign-in
 * and registration untracked for the first moment of every visit, and it would
 * make each page view a request to the API. Reading here means one cached read
 * serves every render in the window, and the snippets are in the HTML the
 * visitor is served rather than arriving after hydration.
 *
 * The read goes to the API's public analytics route, which is the second
 * unauthenticated "what is this deployment configured to do" call that exists —
 * the console's own server render has no session cookie to send, so the
 * authenticated route is out of reach. It is made against API_PROXY_TARGET
 * directly rather than through the /api/* rewrite, because a server render has
 * no browser origin for that rewrite to resolve against. That variable has to
 * be present at runtime, not only as the build arg the rewrite is compiled from.
 *
 * The route answers with the settings object itself, not wrapped in an
 * `analytics` envelope the way the administrative reads are, so the fields are
 * read off the root by parseAnalyticsConfig. Reading them from a wrapper
 * silently yields undefined, which fails closed here — but as "tracking is off"
 * with nothing anywhere to explain it.
 */

import { parseAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics-config";

/** The API as this container reaches it, matching next.config.ts's default. */
const apiBase = (process.env.API_PROXY_TARGET || "http://localhost:8080").replace(/\/$/, "");

/**
 * The tracking configuration, or null when nothing is configured.
 *
 * The response is cached for a few seconds. Unlike the registration flag, which
 * is read once at boot and cannot change under a running deployment, this value
 * is edited at runtime — so the window is a real staleness rather than a
 * formality, and it is kept short enough that an operator who saves a tracking
 * id and reloads sees it.
 *
 * A window is still worth having: it bounds this container's calls to the API
 * at twelve a minute however busy the site is, rather than one per page view.
 *
 * Anything short of a valid configuration — an unreachable API, a non-200, a
 * value that fails validation — answers null, and the caller injects nothing.
 * Tracking must never be able to break a page.
 */
export async function publicAnalyticsConfig(): Promise<AnalyticsConfig | null> {
  try {
    const response = await fetch(`${apiBase}/api/v1/analytics/public`, { next: { revalidate: 5 } });
    if (!response.ok) return null;
    return parseAnalyticsConfig(await response.json());
  } catch {
    return null;
  }
}
