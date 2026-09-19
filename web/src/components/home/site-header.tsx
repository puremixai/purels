import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { T } from "@/lib/i18n";
import { SECTIONS } from "./sections";

/**
 * The landing page's header, sticky so the sections stay one click away.
 *
 * A server component: the only client-side thing inside is the language select,
 * which is why the anchors are plain `<a>` rather than `next/link` — a fragment
 * has nothing to prefetch and nothing for the client router to do.
 *
 * The right-hand side always carries exactly one filled button. When sign-up is
 * closed that button is Sign in rather than Get started, because otherwise a
 * closed deployment would leave the header with no way in at all.
 */
export function SiteHeader({ t, registrationOpen }: { t: T; registrationOpen: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-5 sm:gap-6">
        <Link className="flex shrink-0 items-center gap-2.5" href="/">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand)] text-base font-bold text-white">P</span>
          {/* A span, not a heading: the page gets exactly one h1 and the hero
              has it. */}
          <span className="text-base font-bold">Purels</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-[var(--muted)] md:flex">
          {SECTIONS.map((section) => (
            <a key={section.id} className="hover:text-[var(--ink)]" href={`#${section.id}`}>
              {t(section.key)}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher className="field-control field-control-inline text-[13px]" />
          {registrationOpen && (
            <Link className="hidden text-sm text-[var(--muted)] hover:text-[var(--ink)] sm:block" href="/login">
              {t("home.nav.signIn")}
            </Link>
          )}
          <Link className="btn-primary" href={registrationOpen ? "/register" : "/login"}>
            {registrationOpen ? t("home.nav.getStarted") : t("home.nav.signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}
