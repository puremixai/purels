import { Icon } from "@/components/icon";
import type { T } from "@/lib/i18n";

/**
 * The questions the landing page is most likely to be asked, answered in the
 * page rather than behind a link away from it.
 *
 * Native `<details>` elements, so this costs no JavaScript at all. The marker
 * has to be hidden twice — `list-none` covers the standard property and the
 * WebKit pseudo-element is still honoured separately — and the plus rotates into
 * a close icon purely from the `open` state.
 */
export function Faq({ t }: { t: T }) {
  return (
    <div className="mt-10 divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {FAQ.map((item) => (
        <details key={item.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
            {t(item.q)}
            <Icon
              name="plus"
              size={16}
              className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-45"
            />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{t(item.a)}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * Paired rather than split into two lists, so an answer cannot drift onto the
 * wrong question. The keys are numbered instead of named after their subject:
 * the wording will be revised, and a slug that no longer matches its question is
 * worse than no slug at all.
 */
const FAQ = [
  { q: "home.faq.q1", a: "home.faq.a1" },
  { q: "home.faq.q2", a: "home.faq.a2" },
  { q: "home.faq.q3", a: "home.faq.a3" },
  { q: "home.faq.q4", a: "home.faq.a4" },
  { q: "home.faq.q5", a: "home.faq.a5" },
  { q: "home.faq.q6", a: "home.faq.a6" },
  { q: "home.faq.q7", a: "home.faq.a7" },
] as const;
