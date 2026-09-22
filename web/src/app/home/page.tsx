"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/i18n-provider";
import { api, LinkRecord, StatsSummary } from "@/lib/api-client";
import { enumLabel, errorText, type T } from "@/lib/i18n";
import { AnimatedCounter } from "@/components/ui/rare/animated-counter";
import { Icon } from "@/components/icon";
import { RareStatus, type RareStatusTone } from "@/components/rare/rare-status";

/**
 * The readiness the probe reported, or "" while it is still in flight. The KPI
 * is only honest if "we do not know yet" is a state of its own — a neutral pill
 * would read as a verdict.
 */
type Readiness = "" | "ready" | "degraded" | "unreachable";

function readinessView(t: T, readiness: Readiness): { tone: RareStatusTone; label: string } {
  if (readiness === "") return { tone: "neutral", label: t("dashboard.statusChecking") };
  if (readiness === "ready") return { tone: "success", label: t("dashboard.statusReady") };
  if (readiness === "degraded") return { tone: "warning", label: t("dashboard.statusDegraded") };
  return { tone: "danger", label: t("dashboard.statusUnreachable") };
}

function statusTone(status: string): RareStatusTone {
  if (status === "active") return "success";
  if (status === "disabled") return "warning";
  if (status === "expired") return "danger";
  return "neutral";
}

export default function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [readiness, setReadiness] = useState<Readiness>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setReadiness("");
    setError("");
    // Readiness settles on its own terms: a deployment whose database is down
    // still has a KPI worth answering with, so one rejected call must not take
    // the other two — or the verdict — down with it.
    const [summary, page, probe] = await Promise.allSettled([
      api.stats.summary(),
      api.links.list({ limit: 5, sort: "created_at_desc" }),
      api.system.readiness(),
    ]);
    if (summary.status === "fulfilled" && page.status === "fulfilled") {
      setStats(summary.value);
      setLinks(page.value.links || []);
    } else {
      const failed = [summary, page].find((result) => result.status === "rejected") as PromiseRejectedResult;
      setError(errorText(t, failed.reason, "error.load"));
    }
    setReadiness(probe.status === "fulfilled" ? probe.value : "unreachable");
    setLoading(false);
    // t is stable per locale, so this refetches only when the language changes.
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Keyed by a name rather than by the label: the label is translated now, and a
  // key that changed with the language would remount every card. A failed read
  // says it is unavailable rather than showing 0, because a zero is a real answer
  // and this page has no such number to report.
  const unavailable = <span className="text-base font-normal text-[var(--muted)]">{t("common.unavailable")}</span>;
  const cards = [
    { key: "links", label: t("dashboard.totalLinks"), value: error ? unavailable : <AnimatedCounter value={stats?.total_links ?? 0} /> },
    { key: "clicks", label: t("dashboard.totalClicks"), value: error ? unavailable : <AnimatedCounter value={stats?.total_clicks ?? 0} /> },
    { key: "status", label: t("dashboard.serviceStatus"), value: <RareStatus role="status" tone={readinessView(t, readiness).tone}>{readinessView(t, readiness).label}</RareStatus> },
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
    {error && (
      <div className="console-alert flex flex-wrap items-center justify-between gap-3" role="alert">
        <span>{error}</span>
        <button type="button" className="btn-secondary" onClick={load}>{t("common.retry")}</button>
      </div>
    )}
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
        <Link href="/home/links" className="text-xs font-semibold text-[var(--brand-ink)]">{t("dashboard.viewAll")}</Link>
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
              <RareStatus tone={statusTone(link.status)}>{enumLabel(t, "statusFilter", link.status)}</RareStatus>
            </div>
          </div>) : error ? (
            <p className="console-empty">{t("common.unavailable")}</p>
          ) : (
            <div className="console-empty flex flex-col items-center gap-3">
              <Icon name="link" size={22} />
              <p>{t("dashboard.empty")}</p>
              <Link className="btn-secondary" href="/home/links/new">{t("links.create")}</Link>
            </div>)}
      </div>
    </section>
  </div>;
}
