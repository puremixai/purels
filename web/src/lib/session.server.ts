import { cookies } from "next/headers";

/**
 * Whether the visitor arriving at the landing page already holds a session.
 *
 * Read on the server, the same way and for the same reason the registration
 * flag is: the header has to choose between a Sign in button and a Console
 * entry in the document it serves. A client-side read would render the
 * anonymous header first — putting a Sign in button in front of an operator who
 * is already signed in, and the wrong link in the HTML a crawler receives — and
 * then swap it once the fetch resolved.
 *
 * The check is skipped entirely when no session cookie is present, which is
 * every anonymous visitor and every crawler: the API's /auth/me answers 401 to
 * all of them, so there is nothing to gain by spending the request to hear it.
 * A cookie that is present is not proof of a session — it can be expired or
 * forged — so the API decides, with the cookie forwarded to it.
 *
 * Anything other than a 200 answers false. A signed-in operator shown a Sign in
 * button during an API outage can still reach /home by signing in; an anonymous
 * visitor shown a Console link would be sent into a console that only bounces
 * them back to /login.
 */

/** The API as this container reaches it, matching next.config.ts's default. */
const apiBase = (process.env.API_PROXY_TARGET || "http://localhost:8080").replace(/\/$/, "");

/** The session cookie the API sets on a successful sign-in. */
const SESSION_COOKIE = "purels_session";

export async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)?.value) return false;
  try {
    // The API's own /auth/me, not a hand-rolled check: it is the only place
    // that knows whether this cookie maps to a live session. CSRF does not
    // apply — the middleware exempts GET — so the session cookie alone is the
    // whole of what has to travel.
    const response = await fetch(`${apiBase}/api/v1/auth/me`, {
      headers: { cookie: jar.toString() },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
