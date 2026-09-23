import type { Metadata } from "next";
import Link from "next/link";
import { Faq } from "@/components/home/faq";
import { HeroMock } from "@/components/home/hero-mock";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { Icon, type IconName } from "@/components/icon";
import { AnimatedCounter } from "@/components/ui/rare/animated-counter";
import { CodeBlock } from "@/components/ui/rare/code-block";
import { FluidOrb } from "@/components/ui/rare/fluid-orb";
import { ScrollProgress } from "@/components/ui/rare/scroll-progress";
import type { MessageKey } from "@/lib/i18n";
import { tFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { registrationEnabled } from "@/lib/public-config.server";
import { hasSession } from "@/lib/session.server";

/**
 * The one page here that is meant to be read without signing in, and the only
 * one a search engine has any business indexing: the console is Disallowed in
 * robots.txt and a short link is answered by the API, which marks both of its
 * HTML pages noindex.
 *
 * It is a server component for that reason — the metadata has to be in the
 * document the crawler is served, and a client component cannot export any. It
 * is also why the sign-up state is read here rather than in the browser: a
 * client-side read would put a Register link in front of every visitor of a
 * closed deployment, and leave it in the HTML a crawler receives.
 *
 * Everything below is a server component. The one piece of JavaScript on the
 * page is the language select in the header; the FAQ opens with `<details>`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = tFor(await getLocale());
  return {
    title: t("home.title"),
    description: t("home.description"),
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  const t = tFor(await getLocale());
  // Both reads are server-side for the same reason: the header has to be right
  // in the document the visitor — or the crawler — is served, not corrected
  // afterwards in the browser.
  const [registrationOpen, signedIn] = await Promise.all([registrationEnabled(), hasSession()]);

  return (
    <>
      <ScrollProgress />
      <SiteHeader t={t} registrationOpen={registrationOpen} signedIn={signedIn} />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand-fill focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand">{t("home.skipToMain")}</a>
      <main id="main-content">
        <section className="relative overflow-hidden border-b border-[var(--line)] bg-canvas">
          <div className="absolute -right-40 top-20 hidden opacity-20 blur-3xl lg:block"><FluidOrb size={520} color="var(--brand)" /></div>
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-14 sm:py-16 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14 lg:py-20">
            <div className="relative z-10 max-w-3xl">
              <p className="inline-flex items-center rounded-full border border-[var(--line)] bg-surface px-3 py-1 text-2xs font-semibold tracking-wide text-[var(--muted)]">
                {t("home.hero.badge")}
              </p>
              <h1 className="mt-4 max-w-3xl text-5xl font-bold leading-[0.98] tracking-[-0.05em] text-balance sm:text-6xl lg:text-6xl">{t("home.hero.title")}</h1>
              <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-pretty text-[var(--muted)]">{t("home.hero.subhead")}</p>
              {/* Sign-up is the only action here. The console entry point is
                  the header's, which is the one place that knows whether the
                  visitor already holds a session — a second Sign in button in
                  the hero would be a second answer to the same question. */}
              {registrationOpen && (
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link className="btn-primary" href="/register">{t("home.hero.ctaPrimary")}</Link>
                </div>
              )}
              <div className="mt-8 grid max-w-xl grid-cols-3 border-t border-[var(--line)] pt-4 text-2xs text-[var(--muted)]">
                <div><AnimatedCounter value={1} className="block text-lg font-semibold text-[var(--ink)]" />{t("home.hero.stat.deploy")}</div>
                <div><AnimatedCounter value={11} className="block text-lg font-semibold text-[var(--ink)]" />{t("home.hero.stat.scopes")}</div>
                <div><AnimatedCounter value={3} className="block text-lg font-semibold text-[var(--ink)]" />{t("home.hero.stat.modes")}</div>
              </div>
            </div>
            <div className="relative min-h-[360px] lg:min-h-[440px]">
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-90"><FluidOrb size={360} color="var(--brand)" /></div>
              <div className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 rotate-[1.5deg] lg:left-4 lg:right-[-2rem]"><HeroMock t={t} /></div>
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-[var(--line)] bg-[var(--canvas)] py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.features.title")}</h2>
            <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--line)] md:grid-cols-12">
              {FEATURES.map((feature, index) => (
                <article key={feature.title} className={`bg-surface p-5 sm:p-6 ${index % 3 === 1 ? "md:col-span-7" : "md:col-span-5"}`}>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-tint text-[var(--brand)]"><Icon name={feature.icon} size={20} /></span>
                  <h3 className="mt-4 text-lg font-semibold">{t(feature.title)}</h3>
                  <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-[var(--muted)]">{t(feature.body)}</p>
                  {feature.icon === "chart" && <MiniChart />}
                  {feature.icon === "pulse" && <RuleDiagram />}
                </article>
              ))}
            </div>
            <ul className="mt-6 flex flex-wrap gap-2">
              {CHIPS.map((chip) => <li key={chip} className="rounded-full border border-[var(--line)] bg-surface px-3 py-1 text-2xs text-[var(--muted)]">{t(chip)}</li>)}
            </ul>
          </div>
        </section>

        <section id="how" className="border-b border-[var(--line)] bg-surface py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.how.title")}</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-0">
              {STEPS.map((step, index) => <li key={step.title} className={`p-1 sm:px-8 ${index > 0 ? "sm:border-l sm:border-[var(--line)]" : ""}`}>
                <span className="text-4xl font-semibold tracking-tight text-[var(--brand)]">0{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{t(step.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t(step.body)}</p>
              </li>)}
            </ol>
          </div>
        </section>

        <section id="self-hosted" className="border-b border-[var(--line)] bg-[var(--canvas)] py-12 lg:py-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">{t("home.selfHost.title")}</h2>
              <p className="mt-3 text-base text-[var(--muted)]">{t("home.selfHost.body")}</p>
              <ul className="mt-4 grid gap-2.5">{POINTS.map((point) => <li key={point} className="flex items-start gap-2.5 text-sm"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />{t(point)}</li>)}</ul>
            </div>
            <TerminalCard />
          </div>
        </section>

        <section id="faq" className="border-b border-[var(--line)] bg-surface py-12 lg:py-16">
          <div className="mx-auto w-full max-w-3xl px-5"><h2 className="text-2xl font-bold sm:text-3xl">{t("home.faq.title")}</h2><Faq t={t} /></div>
        </section>

        <section className="bg-brand-fill py-12 lg:py-16">
          <div className="mx-auto w-full max-w-3xl px-5 text-center"><h2 className="text-2xl font-bold text-balance text-on-brand sm:text-3xl">{t("home.cta.title")}</h2><p className="mt-3 text-base text-on-brand">{t("home.cta.body")}</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link className="btn-secondary bg-canvas text-brand-ink hover:text-brand-ink" href={registrationOpen ? "/register" : "/login"}>{registrationOpen ? t("home.cta.button") : t("home.hero.ctaSecondary")}</Link></div></div>
        </section>
      </main>
      <SiteFooter t={t} registrationOpen={registrationOpen} />
    </>
  );
}

function TerminalCard() {
  return <CodeBlock code={'$ cp .env.example .env\n$ docker compose -f deploy/compose.yaml up -d\n$ curl localhost/readyz\n{"status":"ready"}'} language="bash" filename="quick-start.sh" />;
}

function MiniChart() {
  return <div className="mt-8 flex h-24 items-end gap-2 border-b border-[var(--line)] pb-1">{[28, 42, 34, 58, 46, 72, 64, 88].map((height, index) => <span key={index} className="flex-1 rounded-t-sm bg-[var(--brand)] opacity-60" style={{ height: `${height}%` }} />)}</div>;
}

function RuleDiagram() {
  return <div className="mt-8 flex items-center gap-2 text-2xs text-[var(--muted)]"><span className="rounded border border-[var(--line)] px-2 py-1">device</span><Icon name="arrow" size={16} className="text-[var(--brand)]" /><span className="rounded border border-[var(--line)] px-2 py-1">destination</span></div>;
}

const FEATURES = [
  { icon: "link", title: "home.feature.links.title", body: "home.feature.links.body" },
  { icon: "chart", title: "home.feature.stats.title", body: "home.feature.stats.body" },
  { icon: "pulse", title: "home.feature.rules.title", body: "home.feature.rules.body" },
  { icon: "key", title: "home.feature.access.title", body: "home.feature.access.body" },
  { icon: "grid", title: "home.feature.gallery.title", body: "home.feature.gallery.body" },
  { icon: "lock", title: "home.feature.privacy.title", body: "home.feature.privacy.body" },
] as const satisfies readonly { icon: IconName; title: MessageKey; body: MessageKey }[];

const CHIPS = ["home.chip.qr", "home.chip.csv", "home.chip.token", "home.chip.rateLimit", "home.chip.domains", "home.chip.probe"] as const;
const STEPS = [
  { title: "home.how.create.title", body: "home.how.create.body" },
  { title: "home.how.share.title", body: "home.how.share.body" },
  { title: "home.how.measure.title", body: "home.how.measure.body" },
] as const satisfies readonly { title: MessageKey; body: MessageKey }[];
const POINTS = ["home.selfHost.point.install", "home.selfHost.point.data", "home.selfHost.point.privacy", "home.selfHost.point.quota"] as const;
