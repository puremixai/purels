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
    // Relative, so it resolves against the metadataBase the root layout derives
    // from this request's host.
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
        <section className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1 text-[12px] font-semibold text-[var(--muted)]">
                {t("home.hero.badge")}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t("home.hero.title")}</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--muted)]">{t("home.hero.subhead")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {registrationOpen && (
                  <Link className="btn-primary" href="/register">
                    {t("home.hero.ctaPrimary")}
                  </Link>
                )}
                <Link className={registrationOpen ? "btn-secondary" : "btn-primary"} href="/login">
                  {t("home.hero.ctaSecondary")}
                </Link>
              </div>
            </div>
            <HeroMock t={t} />
          </div>
        </section>

        <section id="features" className="border-b border-[var(--line)] bg-[var(--canvas)] py-16 lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.features.title")}</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="panel p-6">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eef1fe] text-[var(--brand)]">
                    <Icon name={feature.icon} size={20} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{t(feature.title)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t(feature.body)}</p>
                </article>
              ))}
            </div>
            <ul className="mt-8 flex flex-wrap gap-2">
              {CHIPS.map((chip) => (
                <li key={chip} className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-[12px] text-[var(--muted)]">
                  {t(chip)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="border-b border-[var(--line)] bg-white py-16 lg:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.how.title")}</h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="panel p-6">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--brand)] text-[13px] font-bold text-white">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{t(step.title)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t(step.body)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="self-hosted" className="border-b border-[var(--line)] bg-[var(--canvas)] py-16 lg:py-24">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">{t("home.selfHost.title")}</h2>
              <p className="mt-4 text-base text-[var(--muted)]">{t("home.selfHost.body")}</p>
              <ul className="mt-6 grid gap-3">
                {POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                    {t(point)}
                  </li>
                ))}
              </ul>
            </div>
            <TerminalCard />
          </div>
        </section>

        <section id="faq" className="border-b border-[var(--line)] bg-white py-16 lg:py-24">
          <div className="mx-auto w-full max-w-3xl px-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("home.faq.title")}</h2>
            <Faq t={t} />
          </div>
        </section>

        <section className="bg-linear-to-br from-[var(--brand)] to-[var(--brand-dark)] py-16 lg:py-20">
          <div className="mx-auto w-full max-w-3xl px-5 text-center">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">{t("home.cta.title")}</h2>
            <p className="mt-4 text-base text-white/85">{t("home.cta.body")}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {/* A white button rather than .btn-primary: that class is
                  unlayered, so a utility could not recolour it, and a brand-blue
                  button on a brand-blue panel would be nearly invisible. */}
              <Link className="btn-secondary" href={registrationOpen ? "/register" : "/login"}>
                {registrationOpen ? t("home.cta.button") : t("home.hero.ctaSecondary")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter t={t} registrationOpen={registrationOpen} />
    </>
  );
}

/**
 * The three commands a first install is. Shown rather than described, because
 * the description of a command is longer than the command.
 *
 * Deliberately not `.panel`: that class sets its background from an unlayered
 * rule, which beats any `bg-*` utility, so the dark surface has to be built out
 * of utilities on its own. See the note on `.field-control-inline` in
 * globals.css.
 */
function TerminalCard() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#2b3550] bg-[#172033] p-5 font-mono text-[13px] leading-relaxed text-[#d7dcea]">
      <p>
        <span className="text-[#7f8aa3]">$</span> cp .env.example .env
      </p>
      <p>
        <span className="text-[#7f8aa3]">$</span> docker compose -f deploy/compose.yaml up -d
      </p>
      <p>
        <span className="text-[#7f8aa3]">$</span> curl localhost/readyz
      </p>
      <p className="text-[#8fd4a4]">{'{"status":"ready"}'}</p>
    </div>
  );
}

/**
 * Six capabilities, one sentence each.
 *
 * Every one of these works in a stock deployment with no configuration. The
 * things that do not — TOTP, OIDC, the scheduled health sweep, the CAPTCHA —
 * are named in the FAQ as things an operator can turn on, never here.
 */
const FEATURES = [
  { icon: "link", title: "home.feature.links.title", body: "home.feature.links.body" },
  { icon: "chart", title: "home.feature.stats.title", body: "home.feature.stats.body" },
  { icon: "pulse", title: "home.feature.rules.title", body: "home.feature.rules.body" },
  { icon: "key", title: "home.feature.access.title", body: "home.feature.access.body" },
  { icon: "shield", title: "home.feature.safety.title", body: "home.feature.safety.body" },
  { icon: "lock", title: "home.feature.privacy.title", body: "home.feature.privacy.body" },
] as const satisfies readonly { icon: IconName; title: MessageKey; body: MessageKey }[];

/**
 * Smaller capabilities, kept to a row of chips. The two qualifiers are not
 * decoration: extra short domains are display only, and the destination check
 * is a button an operator presses rather than a schedule that runs.
 */
const CHIPS = [
  "home.chip.qr",
  "home.chip.csv",
  "home.chip.token",
  "home.chip.rateLimit",
  "home.chip.domains",
  "home.chip.probe",
] as const;

const STEPS = [
  { title: "home.how.create.title", body: "home.how.create.body" },
  { title: "home.how.share.title", body: "home.how.share.body" },
  { title: "home.how.measure.title", body: "home.how.measure.body" },
] as const satisfies readonly { title: MessageKey; body: MessageKey }[];

const POINTS = [
  "home.selfHost.point.stack",
  "home.selfHost.point.start",
  "home.selfHost.point.data",
  "home.selfHost.point.quota",
] as const;
