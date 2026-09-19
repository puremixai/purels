import type { Metadata } from "next";
import Link from "next/link";
import { Faq } from "@/components/home/faq";
import { HeroMock } from "@/components/home/hero-mock";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { Icon, type IconName } from "@/components/icon";
import type { MessageKey } from "@/lib/i18n";
import { tFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { registrationEnabled } from "@/lib/public-config.server";

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
  const registrationOpen = await registrationEnabled();

  return (
    <>
      <SiteHeader t={t} registrationOpen={registrationOpen} />
      <main>
        <section className="border-b border-[var(--line)] bg-surface">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 lg:py-24">
            <div className="max-w-3xl">
              <p className="inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1 text-2xs font-semibold text-[var(--muted)]">
                {t("home.hero.badge")}
              </p>
              <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-[-0.03em] text-balance sm:text-6xl">{t("home.hero.title")}</h1>
              <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-pretty text-[var(--muted)]">{t("home.hero.subhead")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {registrationOpen && <Link className="btn-primary" href="/register">{t("home.hero.ctaPrimary")}</Link>}
                <Link className={registrationOpen ? "btn-secondary" : "btn-primary"} href="/login">{t("home.hero.ctaSecondary")}</Link>
              </div>
              <div className="mt-10 grid max-w-xl grid-cols-3 border-t border-[var(--line)] pt-5 text-2xs text-[var(--muted)]">
                <div><span className="block text-lg font-semibold text-[var(--ink)]">100%</span>self-hosted</div>
                <div><span className="block text-lg font-semibold text-[var(--ink)]">10</span>permission scopes</div>
                <div><span className="block text-lg font-semibold text-[var(--ink)]">0</span>vendor lock-in</div>
              </div>
            </div>
            <div className="relative mt-14 lg:mt-16">
              <div className="absolute -inset-6 -z-10 rounded-[32px] bg-brand-tint blur-3xl" />
              <HeroMock t={t} />
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-[var(--line)] bg-[var(--canvas)] py-16 lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.features.title")}</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--line)] md:grid-cols-12">
              {FEATURES.map((feature, index) => (
                <article key={feature.title} className={`bg-surface p-6 sm:p-8 ${index % 3 === 1 ? "md:col-span-7" : "md:col-span-5"}`}>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-tint text-[var(--brand)]"><Icon name={feature.icon} size={20} /></span>
                  <h3 className="mt-5 text-lg font-semibold">{t(feature.title)}</h3>
                  <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-[var(--muted)]">{t(feature.body)}</p>
                  {feature.icon === "chart" && <MiniChart />}
                  {feature.icon === "pulse" && <RuleDiagram />}
                </article>
              ))}
            </div>
            <ul className="mt-8 flex flex-wrap gap-2">
              {CHIPS.map((chip) => <li key={chip} className="rounded-full border border-[var(--line)] bg-surface px-3 py-1 text-2xs text-[var(--muted)]">{t(chip)}</li>)}
            </ul>
          </div>
        </section>

        <section id="how" className="border-b border-[var(--line)] bg-surface py-16 lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.how.title")}</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-0">
              {STEPS.map((step, index) => <li key={step.title} className={`p-1 sm:px-8 ${index > 0 ? "sm:border-l sm:border-[var(--line)]" : ""}`}>
                <span className="text-4xl font-semibold tracking-tight text-[var(--brand)]">0{index + 1}</span>
                <h3 className="mt-5 text-lg font-semibold">{t(step.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t(step.body)}</p>
              </li>)}
            </ol>
          </div>
        </section>

        <section id="self-hosted" className="border-b border-[var(--line)] bg-[var(--canvas)] py-16 lg:py-24">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">{t("home.selfHost.title")}</h2>
              <p className="mt-4 text-base text-[var(--muted)]">{t("home.selfHost.body")}</p>
              <ul className="mt-6 grid gap-3">{POINTS.map((point) => <li key={point} className="flex items-start gap-2.5 text-sm"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />{t(point)}</li>)}</ul>
            </div>
            <TerminalCard />
          </div>
        </section>

        <section id="faq" className="border-b border-[var(--line)] bg-surface py-16 lg:py-24">
          <div className="mx-auto w-full max-w-3xl px-5"><h2 className="text-2xl font-bold sm:text-3xl">{t("home.faq.title")}</h2><Faq t={t} /></div>
        </section>

        <section className="bg-linear-to-br from-[var(--brand)] to-[var(--brand-dark)] py-16 lg:py-20">
          <div className="mx-auto w-full max-w-3xl px-5 text-center"><h2 className="text-2xl font-bold text-white sm:text-3xl">{t("home.cta.title")}</h2><p className="mt-4 text-base text-white/85">{t("home.cta.body")}</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link className="btn-secondary" href={registrationOpen ? "/register" : "/login"}>{registrationOpen ? t("home.cta.button") : t("home.hero.ctaSecondary")}</Link></div></div>
        </section>
      </main>
      <SiteFooter t={t} registrationOpen={registrationOpen} />
    </>
  );
}

function TerminalCard() {
  return <div className="overflow-hidden rounded-[14px] border border-[#2b3550] bg-[#172033] p-5 font-mono text-sm leading-relaxed text-[#d7dcea]"><p><span className="text-[#7f8aa3]">$</span> cp .env.example .env</p><p><span className="text-[#7f8aa3]">$</span> docker compose -f deploy/compose.yaml up -d</p><p><span className="text-[#7f8aa3]">$</span> curl localhost/readyz</p><p className="text-[#8fd4a4]">{'{"status":"ready"}'}</p></div>;
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
  { icon: "shield", title: "home.feature.safety.title", body: "home.feature.safety.body" },
  { icon: "lock", title: "home.feature.privacy.title", body: "home.feature.privacy.body" },
] as const satisfies readonly { icon: IconName; title: MessageKey; body: MessageKey }[];

const CHIPS = ["home.chip.qr", "home.chip.csv", "home.chip.token", "home.chip.rateLimit", "home.chip.domains", "home.chip.probe"] as const;
const STEPS = [
  { title: "home.how.create.title", body: "home.how.create.body" },
  { title: "home.how.share.title", body: "home.how.share.body" },
  { title: "home.how.measure.title", body: "home.how.measure.body" },
] as const satisfies readonly { title: MessageKey; body: MessageKey }[];
const POINTS = ["home.selfHost.point.stack", "home.selfHost.point.start", "home.selfHost.point.data", "home.selfHost.point.quota"] as const;
