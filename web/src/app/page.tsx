import type { Metadata } from "next";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { tFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

/**
 * The one page here that is meant to be read without signing in, and the only
 * one a search engine has any business indexing: the console is Disallowed in
 * robots.txt and a short link is answered by the API, which marks both of its
 * HTML pages noindex.
 *
 * It is a server component for that reason — the metadata has to be in the
 * document the crawler is served, and a client component cannot export any.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = tFor(await getLocale());
  return {
    title: t("home.title"),
    description: t("home.description"),
    // Relative, so it resolves against the metadataBase the root layout derives
    // from this request's host.
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  const t = tFor(await getLocale());
  const features = ["home.feature.links", "home.feature.stats", "home.feature.access", "home.feature.signin"] as const;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-10">
      <section className="panel w-full max-w-lg p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-lg font-bold text-white">P</div>
          <h1 className="text-xl font-bold">Purels</h1>
        </div>
        <p className="mb-6 text-[var(--muted)]">{t("home.tagline")}</p>
        <ul className="mb-8 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          {features.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
              {t(key)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Link className="btn-primary flex-1" href="/login">
            {t("login.submit")}
          </Link>
          <Link className="btn-secondary flex-1" href="/register">
            {t("login.register")}
          </Link>
        </div>
        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <LocaleSwitcher className="field-control text-[13px] text-slate-600" />
        </div>
      </section>
    </main>
  );
}
