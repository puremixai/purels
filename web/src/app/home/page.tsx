"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/i18n-provider";
import { api, LinkRecord, StatsSummary } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";
import { AnimatedCounter } from "@/components/ui/rare/animated-counter";
import { RareStatus } from "@/components/rare/rare-status";

export default function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([api.stats.summary(), api.links.list({ limit: 5, sort: "created_at_desc" })])
      .then(([summary, page]) => {
        setStats(summary);
        setLinks(page.links || []);
      })
      .catch((e) => setError(errorText(t, e, "error.load")))
      .finally(() => setLoading(false));
    // t is stable per locale, so this refetches only when the language changes.
  }, [t]);

  // Keyed by a name rather than by the label: the label is translated now, and a
  // key that changed with the language would remount every card.
  const cards = [
    { key: "links", label: t("dashboard.totalLinks"), value: <AnimatedCounter value={stats?.total_links ?? 0} /> },
    { key: "clicks", label: t("dashboard.totalClicks"), value: <AnimatedCounter value={stats?.total_clicks ?? 0} /> },
    { key: "status", label: t("dashboard.serviceStatus"), value: <RareStatus tone="success">{t("dashboard.healthy")}</RareStatus> },
  ];

  return <div className="console-page">
    <div className="console-page-header">
      <div className="console-page-heading">
        <p className="console-breadcrumb">{t("shell.workspace")} / {t("nav.overview")}</p>
        <h1 className="console-page-title">{t("nav.overview")}</h1>
      </div>
      <div className="console-actions">
        <Link className="btn-primary" href="/home/links/new">{t("links.create")}</Link>
      </div>
    </div>
    {error && <p className="console-alert" role="alert">{error}</p>}
    <div className="console-kpi-grid">
      {loading
        ? ["links", "clicks", "status"].map((key) => <div className="console-kpi" key={key}><span className="console-skeleton w-24" /><span className="console-skeleton mt-4 w-20" /></div>)
        : cards.map((card) => <div className="console-kpi" key={card.key}>
          <p className="text-xs font-semibold text-[var(--muted)]">{card.label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{card.value}</p>
        </div>)}
    </div>
    <section className="console-panel">
      <div className="console-panel-header">
        <h2 className="console-panel-title">{t("dashboard.recentLinks")}</h2>
        <Link href="/home/links" className="text-xs font-semibold text-[var(--brand)]">{t("dashboard.viewAll")}</Link>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {loading
          ? ["one", "two", "three"].map((key) => <div className="console-list-row" key={key}><div className="min-w-0 flex-1"><span className="console-skeleton w-32" /><span className="console-skeleton mt-2 w-64 max-w-full" /></div><span className="console-skeleton w-16" /></div>)
          : links.length ? links.map((link) => <div className="console-list-row" key={link.id}>
            <div className="min-w-0">
              <p className="font-medium">/{link.alias}</p>
              <p className="truncate text-xs text-[var(--muted)]">{link.destination_url}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-[var(--muted)] tabular-nums">{t("dashboard.clicks", { count: link.clicks ?? 0 })}</span>
              <span className="rounded-full bg-success-tint px-2 py-0.5 text-2xs text-success">{link.status}</span>
            </div>
          </div>) : <p className="console-empty">{t("dashboard.empty")}</p>}
      </div>
    </section>
  </div>;
}
