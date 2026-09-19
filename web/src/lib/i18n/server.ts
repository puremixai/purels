import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./index";

/**
 * The locale for this request.
 *
 * Reading cookies here is what opts the app into dynamic rendering. That is the
 * intended trade: the alternative is rendering English first and correcting it
 * in the browser, which flashes the wrong language on every load and leaves
 * <html lang> wrong during first paint.
 *
 * The cookie is attacker-controlled, so it is narrowed before it is allowed to
 * select a dictionary.
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
