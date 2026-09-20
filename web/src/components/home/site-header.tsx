import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import type { T } from "@/lib/i18n";
import { SECTIONS } from "./sections";

/**
 * The landing page's header, sticky so the sections stay one click away.
 *
 * A server component: the only client-side thing inside is the language select,
 * which is why the anchors are plain `<a>` rather than `next/link` — a fragment
 * has nothing to prefetch and nothing for the client router to do.
 *
 * The right-hand side always keeps the filled action as Sign in. Registration
 * is an optional secondary link, so the console entry point never changes
 * route when sign-up is enabled or disabled.
 */
export function SiteHeader({ t, registrationOpen }: { t: T; registrationOpen: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-surface/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-5 sm:gap-6">
        <Link className="flex shrink-0 items-center gap-2.5" href="/">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--brand)] text-base font-bold text-[#100b08]">P</span>
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
          <Link className="hover:text-[var(--ink)]" href="/home">
            {t("home.nav.console")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <LocaleSwitcher className="field-control field-control-inline text-sm" />
          {registrationOpen && (
            <Link className="hidden text-sm text-[var(--muted)] hover:text-[var(--ink)] sm:block" href="/register">
              {t("home.nav.getStarted")}
            </Link>
          )}
          <Link className="btn-primary" href="/login">
            {t("home.nav.signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}
