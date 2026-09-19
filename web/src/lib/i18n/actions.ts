"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "./index";

/**
 * Remembers an explicit language choice.
 *
 * This is a Server Action rather than a `document.cookie` write followed by
 * `router.refresh()`. Two reasons. `cookies().set` is only legal in an action or
 * a Route Handler, and an action returns the re-rendered tree with the new cookie
 * already attached, in one round trip. And `router.refresh()` only clears the
 * client cache for the current route: it does not promise the root layout
 * re-renders, and its RSC request can carry the cookie as it was before the
 * write, which makes the switch a silent no-op.
 *
 * A full page reload would work, but it would throw away whatever the operator
 * had half-typed into a form. An action does not unmount the page.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    // The value is only ever read on the server, so client script has no reason
    // to see it. It is not a credential, but there is nothing to gain by
    // exposing it either.
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
}
