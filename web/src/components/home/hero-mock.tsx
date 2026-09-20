import { Icon } from "@/components/icon";
import type { T } from "@/lib/i18n";

/**
 * A hand-drawn picture of the console, beside the hero.
 *
 * Drawn in markup rather than shipped as an image: the repository has no public
 * directory and the standalone build would not copy one, so there is nowhere for
 * an asset to live. Being markup also means it inherits the theme and stays
 * sharp at any zoom.
 *
 * Every value in it is invented. The host is example.com, which RFC 2606
 * reserves for exactly this, so nobody mistakes the short link for one that
 * works — and the whole card is aria-hidden, because a screen reader gains
 * nothing from being read a picture.
 */
export function HeroMock({ t }: { t: T }) {
  return (
    <div aria-hidden="true" className="panel overflow-hidden bg-[var(--ui-surface)]/95 backdrop-blur-xl">
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-[var(--ui-surface-elevated)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
      </div>
      <div className="p-5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("home.hero.mock.link")}</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 py-2">
          <Icon name="link" size={15} className="shrink-0 text-[var(--brand)]" />
          <span className="font-mono text-sm">example.com/aB3xK9</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <MockStat label={t("home.hero.mock.links")} value="128" />
          <MockStat label={t("home.hero.mock.clicks")} value="24,806" />
          <MockStat label={t("home.hero.mock.visitors")} value="9,412" />
        </div>
        <div className="mt-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("home.hero.mock.trend")}</p>
          <svg className="mt-3 w-full" viewBox="0 0 280 96" fill="none">
            {BARS.map((height, index) => (
              <rect
                key={index}
                x={index * 40 + 6}
                y={96 - height}
                width={28}
                height={height}
                rx={4}
                fill="var(--brand)"
                opacity={0.3 + index * 0.1}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function MockStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--ui-surface-elevated)] px-3 py-2">
      <p className="text-2xs text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 text-base font-bold">{value}</p>
    </div>
  );
}

/** Seven days of a plausible week, tallest last. */
const BARS = [38, 54, 46, 72, 61, 88, 96];
