import Link from "next/link";
import type { T } from "@/lib/i18n";
import { SECTIONS } from "./sections";

/**
 * The landing page's footer.
 *
 * The section links are repeated from the header on purpose: by the time a
 * reader reaches the bottom, the sticky header is the far end of a long page.
 * The Register link is conditional for the same reason the header's is — a
 * closed deployment must not advertise a form it will refuse.
 */
export function SiteFooter({ t, registrationOpen }: { t: T; registrationOpen: boolean }) {
  return (
    <footer className="border-t border-[var(--line)] bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--brand)] text-base font-bold text-[#100b08]">P</span>
            <span className="text-base font-bold">Purels</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{t("home.footer.tagline")}</p>
        </div>
        <ul className="grid content-start gap-2 text-sm text-[var(--muted)]">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a className="hover:text-[var(--ink)]" href={`#${section.id}`}>
                {t(section.key)}
              </a>
            </li>
          ))}
        </ul>
        <ul className="grid content-start gap-2 text-sm text-[var(--muted)]">
          <li>
            <Link className="hover:text-[var(--ink)]" href="/login">
              {t("home.nav.signIn")}
            </Link>
          </li>
          {registrationOpen && (
            <li>
              <Link className="hover:text-[var(--ink)]" href="/register">
                {t("home.nav.getStarted")}
              </Link>
            </li>
          )}
        </ul>
      </div>
      <div className="border-t border-[var(--line)]">
        <p className="mx-auto w-full max-w-6xl px-5 py-5 text-sm text-[var(--muted)]">
          {t("home.footer.license")} · {t("home.footer.copyright")}
        </p>
      </div>
    </footer>
  );
}
