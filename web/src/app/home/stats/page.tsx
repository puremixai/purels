"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ClickPage, DateRange, LinkRecord, LinkStats, StatsOverview } from "@/lib/api-client";
import { useLocale, useT } from "@/components/i18n-provider";
import { downloadCsv } from "@/lib/csv";
import { formatNumber, formatShortDateTime } from "@/lib/format";
import { errorText, hasMessage, type Locale, type MessageKey, type T } from "@/lib/i18n";
import { AnimatedCounter } from "@/components/ui/rare/animated-counter";
import { GooeyNav } from "@/components/ui/rare/gooey-nav";

const CLICK_PAGE_SIZE = 20;

// The label is a key rather than text: the preset list is built once at module
// scope, before any locale is known, and resolved when it is rendered.
const RANGE_PRESETS = [
  { value: "today", labelKey: "stats.range.today", days: 0 },
  { value: "7d", labelKey: "stats.range.7d", days: 6 },
  { value: "30d", labelKey: "stats.range.30d", days: 29 },
  { value: "90d", labelKey: "stats.range.90d", days: 89 },
  { value: "365d", labelKey: "stats.range.365d", days: 364 },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey; days: number }>;

type PresetValue = (typeof RANGE_PRESETS)[number]["value"];

function deviceLabel(t: T, device: string) {
  const key = `deviceStat.${device}`;
  return hasMessage(key) ? t(key) : device;
}

function toIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function rangeForPreset(preset: PresetValue): DateRange {
  const days = RANGE_PRESETS.find((item) => item.value === preset)?.days ?? 29;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function TrendChart({ points }: { points: StatsOverview["trend"] }) {
  const t = useT();
  const max = points.reduce((peak, point) => Math.max(peak, point.clicks), 0);
  if (!points.length) return <p className="text-sm text-[var(--muted)]">{t("stats.noClicks")}</p>;
  const gap = points.length > 120 ? "gap-0" : points.length > 45 ? "gap-px" : "gap-[3px]";
  return (
    <div>
      <div className={`flex h-40 items-end ${gap}`}>
        {points.map((point) => (
          <div
            key={point.day}
            className="flex-1 rounded-t bg-[var(--brand)] opacity-80 hover:opacity-100"
            style={{ height: `${max ? Math.max(2, (point.clicks / max) * 100) : 2}%` }}
            title={t("stats.pointTitle", { day: String(point.day).slice(0, 10), count: point.clicks })}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        <span>{String(points[0].day).slice(0, 10)}</span>
        <span>{t("stats.peak", { count: max })}</span>
        <span>{String(points[points.length - 1].day).slice(0, 10)}</span>
      </div>
    </div>
  );
}

function BarList({
  rows,
  emptyText,
  locale,
}: {
  rows: Array<{ key: string; label: string; clicks: number }>;
  emptyText: string;
  locale: Locale;
}) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.clicks), 0);
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">{emptyText}</p>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate" title={row.label}>{row.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--muted)]">{formatNumber(row.clicks, locale)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-canvas">
            <div className="h-1.5 rounded-full bg-[var(--brand)]" style={{ width: `${max ? Math.max(3, (row.clicks / max) * 100) : 3}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StatsPage() {
  const t = useT();
  const locale = useLocale();
  const [preset, setPreset] = useState<PresetValue>("30d");
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [ranking, setRanking] = useState<LinkRecord[]>([]);
  const [order, setOrder] = useState<"top" | "bottom">("top");
  const [allLinks, setAllLinks] = useState<LinkRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<LinkStats | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clickLog, setClickLog] = useState<ClickPage | null>(null);
  const [clickPage, setClickPage] = useState(0);
  const [clickLoading, setClickLoading] = useState(false);
  const [error, setError] = useState("");

  const range = useMemo(() => rangeForPreset(preset), [preset]);

  useEffect(() => {
    let cancelled = false;
    api.stats
      .overview(range)
      .then((result) => { if (!cancelled) { setOverview(result); setError(""); } })
      .catch((e) => { if (!cancelled) setError(errorText(t, e, "stats.loadFailed")); });
    return () => { cancelled = true; };
  }, [range, t]);

  useEffect(() => {
    let cancelled = false;
    api.stats
      .top(order, 10, range)
      .then((links) => { if (!cancelled) setRanking(links); })
      .catch((e) => { if (!cancelled) setError(errorText(t, e, "stats.loadRankingFailed")); });
    return () => { cancelled = true; };
  }, [order, range, t]);

  useEffect(() => {
    api.links
      .list({ limit: 100, sort: "created_at_desc" })
      .then((page) => setAllLinks(page.links || []))
      .catch(() => { /* the overview request already surfaces connection errors */ });
  }, []);

  // Keep a link selected at all times so the detail panel is never empty.
  useEffect(() => {
    setSelected((current) => (ranking.some((link) => link.id === current) ? current : (ranking[0]?.id ?? "")));
  }, [ranking]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api.stats
      .link(selected, range)
      .then((result) => { if (!cancelled) setDetail(result.stats); })
      .catch((e) => { if (!cancelled) setError(errorText(t, e, "stats.loadDetailFailed")); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected, range, t]);

  // A different link or window starts the log back at page one.
  useEffect(() => {
    setClickPage(0);
  }, [selected, range]);

  useEffect(() => {
    if (!selected) {
      setClickLog(null);
      return;
    }
    let cancelled = false;
    setClickLoading(true);
    api.stats
      .linkClicks(selected, range, { limit: CLICK_PAGE_SIZE, offset: clickPage * CLICK_PAGE_SIZE })
      .then((result) => { if (!cancelled) setClickLog(result); })
      .catch((e) => { if (!cancelled) setError(errorText(t, e, "stats.loadClicksFailed")); })
      .finally(() => { if (!cancelled) setClickLoading(false); });
    return () => { cancelled = true; };
  }, [selected, range, clickPage, t]);

  const exportRanking = useCallback(() => {
    downloadCsv(`purels-ranking-${range.from}_${range.to}.csv`, [
      [t("stats.csv.rank"), t("stats.table.short"), t("stats.csv.destination"), t("stats.table.clicks")],
      ...ranking.map((link, index) => [index + 1, `/${link.alias}`, link.destination_url, link.clicks ?? 0]),
    ]);
  }, [ranking, range, t]);

  const exportTrend = useCallback(() => {
    downloadCsv(`purels-trend-${range.from}_${range.to}.csv`, [
      [t("stats.csv.date"), t("stats.table.clicks")],
      ...(overview?.trend ?? []).map((point) => [String(point.day).slice(0, 10), point.clicks]),
    ]);
  }, [overview, range, t]);

  const detailAlias = allLinks.find((link) => link.id === selected)?.alias
    ?? ranking.find((link) => link.id === selected)?.alias
    ?? "";
  const maxDaily = detail?.daily.reduce((peak, item) => Math.max(peak, item.clicks), 0) ?? 0;
  // Under IP_HASH_MODE=none nothing is stored, so the figure is structurally
  // zero rather than genuinely zero: showing it would report "no visitors".
  const showVisitors = overview?.ip_mode !== "none";

  return (
    <div className="console-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")}</p>
          <h1 className="console-page-title">{t("stats.title")}</h1>
        </div>
        <GooeyNav
          size="sm"
          ariaLabel={t("stats.title")}
          items={RANGE_PRESETS.map((option) => t(option.labelKey))}
          value={Math.max(0, RANGE_PRESETS.findIndex((option) => option.value === preset))}
          onChange={(index) => setPreset(RANGE_PRESETS[index]?.value ?? "30d")}
        />
      </div>

      {error && <p className="console-alert" role="alert">{error}</p>}

      <div className={`console-kpi-grid ${showVisitors ? "" : "sm:grid-cols-2"}`}>
        <div className="console-kpi">
          <p className="text-xs font-semibold text-[var(--muted)]">{t("stats.clicksInRange")}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight"><AnimatedCounter value={overview?.total_clicks ?? 0} /></p>
        </div>
        {showVisitors && (
          <div className="console-kpi">
            <p className="text-xs font-semibold text-[var(--muted)]">{t("stats.uniqueVisitors")}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight"><AnimatedCounter value={overview?.unique_visitors ?? 0} /></p>
          </div>
        )}
        <div className="console-kpi">
          <p className="text-xs font-semibold text-[var(--muted)]">{t("stats.totalLinks")}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight"><AnimatedCounter value={overview?.total_links ?? 0} /></p>
        </div>
      </div>

      <section className="console-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="console-panel-title">{t("stats.trend")}</h2>
          <button className="btn-secondary" onClick={exportTrend}>{t("stats.exportCsv")}</button>
        </div>
        <TrendChart points={overview?.trend ?? []} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="console-panel">
          <div className="console-panel-header">
            <h2 className="console-panel-title">{t("stats.ranking")}</h2>
            <GooeyNav
              size="sm"
              ariaLabel={t("stats.ranking")}
              items={[t("stats.most"), t("stats.fewest")]}
              value={order === "top" ? 0 : 1}
              onChange={(index) => setOrder(index === 1 ? "bottom" : "top")}
            />
          </div>
          <div className="mobile-scroll">
            <table className="console-table min-w-[420px]">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>{t("stats.table.short")}</th>
                  <th className="text-right">{t("stats.table.clicks")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {ranking.map((link, index) => (
                  <tr
                    key={link.id}
                    onClick={() => setSelected(link.id)}
                    className={`cursor-pointer transition-colors ${selected === link.id ? "bg-brand-tint" : "hover:bg-canvas-alt"}`}
                  >
                    <td className="tabular-nums text-[var(--muted)]">{index + 1}</td>
                    <td className="max-w-[220px] truncate font-medium" title={link.destination_url}>/{link.alias}</td>
                    <td className="text-right font-medium tabular-nums">{link.clicks ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ranking.length && <p className="console-empty">{t("stats.emptyRanking")}</p>}
          </div>
          <div className="border-t border-[var(--line)] px-4 py-2.5 text-right">
            <button className="btn-secondary" onClick={exportRanking} disabled={!ranking.length}>{t("stats.exportRanking")}</button>
          </div>
        </section>

        <div className="space-y-4">
          <section className="console-panel p-4 sm:p-5">
            <h2 className="mb-4 console-panel-title">{t("stats.referrers")}</h2>
            <BarList
              rows={(overview?.referrers ?? []).map((item) => ({
                key: item.referrer || "__direct__",
                label: item.referrer || t("stats.direct"),
                clicks: item.clicks,
              }))}
              emptyText={t("stats.emptyReferrers")}
              locale={locale}
            />
          </section>

          <section className="console-panel p-4 sm:p-5">
            <h2 className="mb-4 console-panel-title">{t("stats.devices")}</h2>
            <BarList
              rows={(overview?.devices ?? []).map((item) => ({
                key: item.device,
                label: deviceLabel(t, item.device),
                clicks: item.clicks,
              }))}
              emptyText={t("stats.emptyDevices")}
              locale={locale}
            />
          </section>
        </div>
      </div>

      <section className="console-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="console-panel-title">{t("stats.linkDetail")}{detailAlias ? ` /${detailAlias}` : ""}</h2>
          <select className="field-control w-auto min-w-[220px]" value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">{t("stats.selectLink")}</option>
            {allLinks.map((link) => <option key={link.id} value={link.id}>/{link.alias}</option>)}
          </select>
        </div>

        {!selected && <p className="text-sm text-[var(--muted)]">{t("stats.noClicks")}</p>}
        {selected && detailLoading && <p className="text-sm text-[var(--muted)]">{t("stats.loading")}</p>}

        {selected && detail && !detailLoading && (
          <div className="space-y-4">
            <div className="rounded-lg bg-canvas-alt px-4 py-3">
              <p className="text-sm text-[var(--muted)]">{t("stats.totalClicks")}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(detail.total_clicks, locale)}</p>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">{t("stats.dailyClicks")}</h3>
              {detail.daily.length ? (
                <div className="space-y-2">
                  {detail.daily.map((item) => (
                    <div key={item.day} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 tabular-nums text-[var(--muted)]">{String(item.day).slice(0, 10)}</span>
                      <span className="h-2 rounded-full bg-[var(--brand)]" style={{ width: `${maxDaily ? Math.max(4, (item.clicks / maxDaily) * 100) : 4}%` }} />
                      <span className="tabular-nums">{formatNumber(item.clicks, locale)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">{t("stats.noClicks")}</p>
              )}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">{t("stats.referrers")}</h3>
              {detail.referrers.length ? (
                <div className="mobile-scroll">
                  <table className="console-table min-w-[420px]">
                    <thead>
                      <tr><th>{t("stats.table.referrer")}</th><th className="text-right">{t("stats.table.clicks")}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {detail.referrers.map((item) => (
                        <tr key={item.referrer || "__direct__"}>
                          <td className="max-w-[420px] truncate">{item.referrer || t("stats.direct")}</td>
                          <td className="text-right tabular-nums">{formatNumber(item.clicks, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">{t("stats.emptyReferrers")}</p>
              )}
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{t("stats.clickLog")}</h3>
                {(clickLog?.total ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <button className="btn-secondary" disabled={clickPage === 0 || clickLoading} onClick={() => setClickPage((current) => Math.max(0, current - 1))}>{t("common.previous")}</button>
                    <span className="tabular-nums">{t("common.page", { page: clickPage + 1, count: Math.max(1, Math.ceil((clickLog?.total ?? 0) / CLICK_PAGE_SIZE)) })}</span>
                    <button className="btn-secondary" disabled={(clickPage + 1) * CLICK_PAGE_SIZE >= (clickLog?.total ?? 0) || clickLoading} onClick={() => setClickPage((current) => current + 1)}>{t("common.next")}</button>
                  </div>
                )}
              </div>
              {clickLoading ? (
                <p className="text-sm text-[var(--muted)]">{t("stats.loading")}</p>
              ) : (clickLog?.clicks ?? []).length ? (
                <div className="mobile-scroll">
                  <table className="console-table min-w-[560px]">
                    <thead>
                      <tr>
                        <th>{t("stats.table.time")}</th>
                        <th>{t("stats.table.referrer")}</th>
                        <th>{t("stats.table.userAgent")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {(clickLog?.clicks ?? []).map((click, index) => (
                        <tr key={`${click.occurred_at}-${index}`}>
                          <td className="whitespace-nowrap tabular-nums text-[var(--muted)]">{formatShortDateTime(click.occurred_at, locale)}</td>
                          <td className="max-w-[200px] truncate text-[var(--muted)]">{click.referrer || t("stats.direct")}</td>
                          <td className="max-w-[320px] truncate text-[var(--muted)]" title={click.user_agent}>{click.user_agent || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">{t("stats.emptyClicks")}</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="console-panel">
        <div className="console-panel-header"><h2 className="console-panel-title">{t("stats.recentClicks")}</h2></div>
        <div className="mobile-scroll">
          <table className="console-table min-w-[720px]">
            <thead>
              <tr>
                <th>{t("stats.table.time")}</th>
                <th>{t("stats.table.short")}</th>
                <th>{t("stats.table.referrer")}</th>
                <th>{t("stats.table.userAgent")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(overview?.recent_clicks ?? []).map((click, index) => (
                <tr key={`${click.link_id}-${click.occurred_at}-${index}`}>
                  <td className="whitespace-nowrap tabular-nums text-[var(--muted)]">{formatShortDateTime(click.occurred_at, locale)}</td>
                  <td className="font-medium">/{click.alias || ""}</td>
                  <td className="max-w-[220px] truncate text-[var(--muted)]">{click.referrer || t("stats.direct")}</td>
                  <td className="max-w-[360px] truncate text-[var(--muted)]" title={click.user_agent}>{click.user_agent || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(overview?.recent_clicks ?? []).length && <p className="console-empty">{t("stats.emptyClicks")}</p>}
        </div>
      </section>

    </div>
  );
}
