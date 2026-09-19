"use client";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { api, LinkRecord, StatsSummary } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";

export default function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.stats.summary(), api.links.list({ limit: 5, sort: "created_at_desc" })])
      .then(([summary, page]) => {
        setStats(summary);
        setLinks(page.links || []);
      })
      .catch((e) => setError(errorText(t, e, "error.load")));
    // t is stable per locale, so this refetches only when the language changes.
  }, [t]);

  // Keyed by a name rather than by the label: the label is translated now, and a
  // key that changed with the language would remount every card.
  const cards = [
    { key: "links", label: t("dashboard.totalLinks"), value: stats?.total_links ?? 0 },
    { key: "clicks", label: t("dashboard.totalClicks"), value: stats?.total_clicks ?? 0 },
    { key: "status", label: t("dashboard.serviceStatus"), value: t("dashboard.healthy") },
  ];

  return <div className="space-y-7">
    <div>
      <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("nav.overview")}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("nav.overview")}</h1>
    </div>
    {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => <div className="panel p-5" key={card.key}>
        <p className="text-sm text-[var(--muted)]">{card.label}</p>
        <p className="mt-3 text-3xl font-bold">{card.value}</p>
      </div>)}
    </div>
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <h2 className="font-semibold">{t("dashboard.recentLinks")}</h2>
        <a href="/admin/links" className="text-sm font-medium text-[var(--brand)]">{t("dashboard.viewAll")}</a>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {links.length ? links.map((link) => <div className="flex items-center justify-between gap-4 px-5 py-4" key={link.id}>
          <div className="min-w-0">
            <p className="font-medium">/{link.alias}</p>
            <p className="truncate text-sm text-[var(--muted)]">{link.destination_url}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-[var(--muted)] tabular-nums">{t("dashboard.clicks", { count: link.clicks ?? 0 })}</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{link.status}</span>
          </div>
        </div>) : <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">{t("dashboard.empty")}</p>}
      </div>
    </section>
  </div>;
}
