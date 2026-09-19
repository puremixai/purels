/**
 * Deployment settings the landing page needs before anybody has signed in.
 *
 * Read on the server rather than in the browser. A client-side read would show
 * every visitor of a closed deployment a Register button and then take it away
 * once the fetch resolved, and — worse for the only page here that is meant to
 * be crawled — the link would still be in the HTML the crawler was served.
 *
 * The read goes to the console's own public CAPTCHA endpoint, which is the one
 * unauthenticated "what can this deployment do" call that exists. It is made
 * against API_PROXY_TARGET directly rather than through the /api/* rewrite,
 * because a server render has no browser origin for that rewrite to resolve
 * against. That variable has to be present at runtime, not only as the build
 * arg the rewrite is compiled from.
 *
 * That endpoint answers with the settings object itself, not wrapped in a
 * `captcha` envelope the way the administrative reads are, so the field is read
 * off the root. Reading it from a `captcha` key silently yields undefined, which
 * this function's fail-open default turns into "registration is open" — the
 * opposite of what a closed deployment should show, and a failure with no error
 * anywhere to explain it.
 */

/** The API as this container reaches it, matching next.config.ts's default. */
const apiBase = (process.env.API_PROXY_TARGET || "http://localhost:8080").replace(/\/$/, "");

/**
 * Whether this deployment accepts new accounts.
 *
 * The response is cached for a minute, which is required rather than an
 * optimisation: the endpoint shares the OIDC rate-limit bucket (60 requests a
 * minute), and every server-side render comes from this one container's address,
 * so an uncached read would spend a single bucket across the whole deployment.
 * A minute of staleness cannot disagree with reality, because
 * REGISTRATION_ENABLED is read once at boot.
 *
 * Anything short of an explicit `false` — an unreachable API, a non-200, a
 * deployment too old to send the field — answers true, and the caller renders
 * no error. The page has to stay renderable without the API, and a Register
 * button on a deployment that then refuses the request is a far smaller failure
 * than a landing page that will not load.
 */
export async function registrationEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/api/v1/auth/captcha`, { next: { revalidate: 60 } });
    if (!response.ok) return true;
    const payload = (await response.json()) as { registration_enabled?: unknown };
    return payload?.registration_enabled !== false;
  } catch {
    return true;
  }
}
