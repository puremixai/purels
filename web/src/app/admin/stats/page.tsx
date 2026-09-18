"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, ClickPage, DateRange, LinkRecord, LinkStats, StatsOverview } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";

const CLICK_PAGE_SIZE = 20;

const RANGE_PRESETS = [
  { value: "today", label: "今天", days: 0 },
  { value: "7d", label: "近 7 天", days: 6 },
  { value: "30d", label: "近 30 天", days: 29 },
  { value: "90d", label: "近 90 天", days: 89 },
  { value: "365d", label: "近 365 天", days: 364 },
] as const;

type PresetValue = (typeof RANGE_PRESETS)[number]["value"];

const DEVICE_LABELS: Record<string, string> = {
  desktop: "桌面",
  mobile: "移动",
  tablet: "平板",
  bot: "机器人",
  unknown: "未知",
};

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

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function TrendChart({ points }: { points: StatsOverview["trend"] }) {
  const max = points.reduce((peak, point) => Math.max(peak, point.clicks), 0);
  if (!points.length) return <p className="text-sm text-[var(--muted)]">该区间暂无点击。</p>;
  const gap = points.length > 120 ? "gap-0" : points.length > 45 ? "gap-px" : "gap-[3px]";
  return (
    <div>
      <div className={`flex h-40 items-end ${gap}`}>
        {points.map((point) => (
          <div
            key={point.day}
            className="flex-1 rounded-t bg-[var(--brand)] opacity-80 hover:opacity-100"
            style={{ height: `${max ? Math.max(2, (point.clicks / max) * 100) : 2}%` }}
            title={`${String(point.day).slice(0, 10)} · ${point.clicks} 次点击`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        <span>{String(points[0].day).slice(0, 10)}</span>
        <span>单日峰值 {max}</span>
        <span>{String(points[points.length - 1].day).slice(0, 10)}</span>
      </div>
    </div>
  );
}

function BarList({ rows, emptyText }: { rows: Array<{ label: string; clicks: number }>; emptyText: string }) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.clicks), 0);
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">{emptyText}</p>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate" title={row.label}>{row.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--muted)]">{row.clicks}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full bg-[var(--brand)]" style={{ width: `${max ? Math.max(3, (row.clicks / max) * 100) : 3}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StatsPage() {
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
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败"); });
    return () => { cancelled = true; };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    api.stats
      .top(order, 10, range)
      .then((links) => { if (!cancelled) setRanking(links); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "加载排行失败"); });
    return () => { cancelled = true; };
  }, [order, range]);

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
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "加载明细失败"); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected, range]);

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
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "加载点击明细失败"); })
      .finally(() => { if (!cancelled) setClickLoading(false); });
    return () => { cancelled = true; };
  }, [selected, range, clickPage]);

  const exportRanking = useCallback(() => {
    downloadCsv(`purels-ranking-${range.from}_${range.to}.csv`, [
      ["排名", "短链接", "目标地址", "点击"],
      ...ranking.map((link, index) => [index + 1, `/${link.alias}`, link.destination_url, link.clicks ?? 0]),
    ]);
  }, [ranking, range]);

  const exportTrend = useCallback(() => {
    downloadCsv(`purels-trend-${range.from}_${range.to}.csv`, [
      ["日期", "点击"],
      ...(overview?.trend ?? []).map((point) => [String(point.day).slice(0, 10), point.clicks]),
    ]);
  }, [overview, range]);

  const detailAlias = allLinks.find((link) => link.id === selected)?.alias
    ?? ranking.find((link) => link.id === selected)?.alias
    ?? "";
  const maxDaily = detail?.daily.reduce((peak, item) => Math.max(peak, item.clicks), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">工作台 / 数据统计</p>
          <h1 className="mt-1 text-2xl font-bold">数据统计</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((option) => (
            <button
              key={option.value}
              className={preset === option.value ? "btn-primary" : "btn-secondary"}
              onClick={() => setPreset(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-6">
          <p className="text-sm text-[var(--muted)]">区间点击</p>
          <p className="mt-3 text-4xl font-bold tabular-nums">{overview?.total_clicks ?? 0}</p>
        </div>
        <div className="panel p-6">
          <p className="text-sm text-[var(--muted)]">独立访客</p>
          <p className="mt-3 text-4xl font-bold tabular-nums">{overview?.unique_visitors ?? 0}</p>
        </div>
        <div className="panel p-6">
          <p className="text-sm text-[var(--muted)]">总链接数</p>
          <p className="mt-3 text-4xl font-bold tabular-nums">{overview?.total_links ?? 0}</p>
        </div>
      </div>

      <section className="panel p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">全局点击趋势</h2>
          <button className="btn-secondary" onClick={exportTrend}>导出 CSV</button>
        </div>
        <TrendChart points={overview?.trend ?? []} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <h2 className="font-semibold">点击排行</h2>
            <div className="flex gap-2">
              <button className={order === "top" ? "btn-primary" : "btn-secondary"} onClick={() => setOrder("top")}>最多</button>
              <button className={order === "bottom" ? "btn-primary" : "btn-secondary"} onClick={() => setOrder("bottom")}>最少</button>
            </div>
          </div>
          <div className="mobile-scroll">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
                <tr>
                  <th className="w-10 px-5 py-3">#</th>
                  <th className="px-5 py-3">短链接</th>
                  <th className="px-5 py-3 text-right">点击</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {ranking.map((link, index) => (
                  <tr
                    key={link.id}
                    onClick={() => setSelected(link.id)}
                    className={`cursor-pointer transition-colors ${selected === link.id ? "bg-[#edf0ff]" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-5 py-3 tabular-nums text-[var(--muted)]">{index + 1}</td>
                    <td className="max-w-[220px] truncate px-5 py-3 font-medium" title={link.destination_url}>/{link.alias}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{link.clicks ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ranking.length && <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">该区间暂无点击数据。</p>}
          </div>
          <div className="border-t border-[var(--line)] px-5 py-3 text-right">
            <button className="btn-secondary" onClick={exportRanking} disabled={!ranking.length}>导出排行 CSV</button>
          </div>
        </section>

        <div className="space-y-6">
          <section className="panel p-6">
            <h2 className="mb-5 font-semibold">来源分布</h2>
            <BarList
              rows={(overview?.referrers ?? []).map((item) => ({ label: item.referrer || "直接访问", clicks: item.clicks }))}
              emptyText="该区间暂无来源数据。"
            />
          </section>

          <section className="panel p-6">
            <h2 className="mb-5 font-semibold">设备分布</h2>
            <BarList
              rows={(overview?.devices ?? []).map((item) => ({ label: DEVICE_LABELS[item.device] ?? item.device, clicks: item.clicks }))}
              emptyText="该区间暂无设备数据。"
            />
          </section>
        </div>
      </div>

      <section className="panel p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">单链接明细{detailAlias ? ` · /${detailAlias}` : ""}</h2>
          <select className="field-control w-auto min-w-[220px]" value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">选择一条链接…</option>
            {allLinks.map((link) => <option key={link.id} value={link.id}>/{link.alias}</option>)}
          </select>
        </div>

        {!selected && <p className="text-sm text-[var(--muted)]">该区间暂无点击。</p>}
        {selected && detailLoading && <p className="text-sm text-[var(--muted)]">加载中…</p>}

        {selected && detail && !detailLoading && (
          <div className="space-y-6">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm text-[var(--muted)]">累计点击</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{detail.total_clicks}</p>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">按天点击</h3>
              {detail.daily.length ? (
                <div className="space-y-2">
                  {detail.daily.map((item) => (
                    <div key={item.day} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 tabular-nums text-[var(--muted)]">{String(item.day).slice(0, 10)}</span>
                      <span className="h-2 rounded-full bg-[var(--brand)]" style={{ width: `${maxDaily ? Math.max(4, (item.clicks / maxDaily) * 100) : 4}%` }} />
                      <span className="tabular-nums">{item.clicks}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">该区间暂无点击。</p>
              )}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">来源分布</h3>
              {detail.referrers.length ? (
                <div className="mobile-scroll">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <tr><th className="py-2">来源</th><th className="py-2 text-right">点击</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {detail.referrers.map((item) => (
                        <tr key={item.referrer || "__direct__"}>
                          <td className="max-w-[420px] truncate py-3">{item.referrer || "直接访问"}</td>
                          <td className="py-3 text-right tabular-nums">{item.clicks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">该区间暂无来源数据。</p>
              )}
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">点击明细</h3>
                {(clickLog?.total ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <button className="btn-secondary" disabled={clickPage === 0 || clickLoading} onClick={() => setClickPage((current) => Math.max(0, current - 1))}>上一页</button>
                    <span className="tabular-nums">第 {clickPage + 1} / {Math.max(1, Math.ceil((clickLog?.total ?? 0) / CLICK_PAGE_SIZE))} 页</span>
                    <button className="btn-secondary" disabled={(clickPage + 1) * CLICK_PAGE_SIZE >= (clickLog?.total ?? 0) || clickLoading} onClick={() => setClickPage((current) => current + 1)}>下一页</button>
                  </div>
                )}
              </div>
              {clickLoading ? (
                <p className="text-sm text-[var(--muted)]">加载中…</p>
              ) : (clickLog?.clicks ?? []).length ? (
                <div className="mobile-scroll">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <tr>
                        <th className="py-2">时间</th>
                        <th className="py-2">来源</th>
                        <th className="py-2">User-Agent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {(clickLog?.clicks ?? []).map((click, index) => (
                        <tr key={`${click.occurred_at}-${index}`}>
                          <td className="whitespace-nowrap py-3 tabular-nums text-[var(--muted)]">{formatTimestamp(click.occurred_at)}</td>
                          <td className="max-w-[200px] truncate py-3 text-[var(--muted)]">{click.referrer || "直接访问"}</td>
                          <td className="max-w-[320px] truncate py-3 text-[var(--muted)]" title={click.user_agent}>{click.user_agent || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">该区间暂无点击记录。</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-[var(--line)] px-6 py-4 font-semibold">最近点击</div>
        <div className="mobile-scroll">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                <th className="px-6 py-3">时间</th>
                <th className="px-6 py-3">短链接</th>
                <th className="px-6 py-3">来源</th>
                <th className="px-6 py-3">User-Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(overview?.recent_clicks ?? []).map((click, index) => (
                <tr key={`${click.link_id}-${click.occurred_at}-${index}`}>
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums text-[var(--muted)]">{formatTimestamp(click.occurred_at)}</td>
                  <td className="px-6 py-3 font-medium">/{click.alias || "—"}</td>
                  <td className="max-w-[220px] truncate px-6 py-3 text-[var(--muted)]">{click.referrer || "直接访问"}</td>
                  <td className="max-w-[360px] truncate px-6 py-3 text-[var(--muted)]" title={click.user_agent}>{click.user_agent || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(overview?.recent_clicks ?? []).length && <p className="px-6 py-10 text-center text-sm text-[var(--muted)]">该区间暂无点击记录。</p>}
        </div>
      </section>

    </div>
  );
}
