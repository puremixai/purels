import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./index";
import { preferredLocale } from "./negotiate";

/**
 * The locale for this request.
 *
 * An explicit choice wins; otherwise the browser is asked, and English is what a
 * client that asks for nothing we ship gets.
 *
 * Reading cookies here is what opts the app into dynamic rendering. That is the
 * intended trade: the alternative is rendering English first and correcting it
 * in the browser, which flashes the wrong language on every load and leaves
 * <html lang> wrong during first paint.
 *
 * The cookie is attacker-controlled, so it is narrowed before it is allowed to
 * select a dictionary. It is matched exactly rather than by primary subtag
 * because this app is the only thing that ever writes it, and setLocale only
 * writes a value it has already narrowed — so a tag like `zh-TW` in the cookie
 * is not a choice we recorded, and is not treated as one.
 *
 * Negotiating on the header means a shared cache in front of this app would have
 * to vary on Accept-Language. There is none — the gateway is a plain reverse
 * proxy — but that is the constraint to remember if one is added.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  return preferredLocale((await headers()).get("accept-language"));
}
