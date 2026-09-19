"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { QrDialog } from "@/components/qr-dialog";
import { api, BulkAction, BulkLinkInput, ImportReport, LinkRecord, LinkSort, LinkStatusFilter, TagStat } from "@/lib/api-client";
import { downloadCsvText } from "@/lib/csv";
import { errorText, type MessageKey, type T } from "@/lib/i18n";
import { parseTags } from "@/lib/tags";

const PAGE_SIZE = 20;

/**
 * The labels are keys rather than text: these lists are built once at module
 * load, before there is a language to resolve them in. The values are the API's
 * own vocabulary and never change.
 */
const SORT_OPTIONS: Array<{ value: LinkSort; labelKey: MessageKey }> = [
  { value: "created_at_desc", labelKey: "sort.createdAtDesc" },
  { value: "created_at_asc", labelKey: "sort.createdAtAsc" },
  { value: "clicks_desc", labelKey: "sort.clicksDesc" },
  { value: "clicks_asc", labelKey: "sort.clicksAsc" },
  { value: "alias_asc", labelKey: "sort.aliasAsc" },
  { value: "alias_desc", labelKey: "sort.aliasDesc" },
];

const STATUS_OPTIONS: Array<{ value: LinkStatusFilter; labelKey: MessageKey }> = [
  { value: "all", labelKey: "statusFilter.all" },
  { value: "active", labelKey: "statusFilter.active" },
  { value: "disabled", labelKey: "statusFilter.disabled" },
  { value: "expired", labelKey: "statusFilter.expired" },
];

const BULK_ACTIONS: Array<{ value: BulkAction; labelKey: MessageKey; needsValue: "none" | "tag" | "date" }> = [
  { value: "disable", labelKey: "bulk.disable", needsValue: "none" },
  { value: "enable", labelKey: "bulk.enable", needsValue: "none" },
  { value: "delete", labelKey: "bulk.delete", needsValue: "none" },
  { value: "tag", labelKey: "bulk.tag", needsValue: "tag" },
  { value: "untag", labelKey: "bulk.untag", needsValue: "tag" },
  { value: "set_expiry", labelKey: "bulk.setExpiry", needsValue: "date" },
];

function statusStyle(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "disabled") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

/** "Check 200" / "Check failed" — only shown once the link has been checked. */
function checkLabel(t: T, link: LinkRecord) {
  if (!link.last_checked_at) return "";
  return link.last_status_code ? t("links.checkOk", { code: link.last_status_code }) : t("links.checkFailed");
}

export default function LinksPage() {
  const t = useT();
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<LinkSort>("created_at_desc");
  const [status, setStatus] = useState<LinkStatusFilter>("all");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<TagStat[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrLink, setQrLink] = useState<LinkRecord | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>("disable");
  const [bulkValue, setBulkValue] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Debounce typing so we do not hit the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadTags = useCallback(async () => {
    try {
      setTags(await api.tags.list());
    } catch {
      // A failed tag lookup only costs us the filter dropdown; the list still works.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.links.list({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort,
        status,
        search: debouncedSearch,
        tag: tag || undefined,
      });
      const records = result.links || [];
      // Deleting the last row of the final page can leave us past the end.
      if (records.length === 0 && page > 0) {
        setPage((current) => Math.max(0, current - 1));
        return;
      }
      setLinks(records);
      setTotal(result.total || 0);
      setError("");
      // The rows on screen have changed, so a selection made against the old
      // ones no longer means anything.
      setSelected(new Set());
    } catch (e) {
      setError(errorText(t, e, "error.load"));
    } finally {
      setLoading(false);
    }
    // t is stable per locale, so the list reloads only when the language changes.
  }, [page, sort, status, tag, debouncedSearch, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  async function remove(id: string) {
    if (!confirm(t("links.confirmDelete"))) return;
    try {
      await api.links.remove(id);
      await load();
      await loadTags();
    } catch (e) {
      setError(errorText(t, e, "error.delete"));
    }
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      const everySelected = links.length > 0 && links.every((link) => current.has(link.id));
      for (const link of links) {
        if (everySelected) next.delete(link.id);
        else next.add(link.id);
      }
      return next;
    });
  }

  async function runBulk() {
    const ids = [...selected];
    if (!ids.length) return;
    const needsValue = BULK_ACTIONS.find((option) => option.value === bulkAction)?.needsValue;
    if (needsValue === "date" && !bulkValue) {
      setError(t("links.bulkNeedDate"));
      return;
    }
    if (bulkAction === "delete" && !confirm(t("links.confirmBulkDelete", { count: ids.length }))) return;

    const input: BulkLinkInput = { action: bulkAction, ids };
    if (needsValue === "tag") {
      const tags = parseTags(bulkValue);
      if (!tags.length) {
        setError(t("links.bulkNeedTag"));
        return;
      }
      input.tags = tags;
    }
    if (needsValue === "date") {
      input.expires_at = new Date(`${bulkValue}T00:00:00Z`).toISOString();
    }

    setBusy(true);
    setError("");
    try {
      const result = await api.links.bulk(input);
      setBulkValue("");
      await load();
      await loadTags();
      // A foreign or already-deleted id is skipped rather than rejected, so the
      // shortfall is reported instead of being silently swallowed.
      if (result.affected < ids.length) {
        setError(t("links.bulkSkipped", { count: ids.length - result.affected }));
      }
    } catch (e) {
      setError(errorText(t, e, "error.bulk"));
    } finally {
      setBusy(false);
    }
  }

  const bulkNeedsValue = BULK_ACTIONS.find((option) => option.value === bulkAction)?.needsValue;

  async function exportCsv() {
    setBusy(true);
    setError("");
    try {
      const content = await api.links.exportCsv({
        sort,
        status,
        search: debouncedSearch,
        tag: tag || undefined,
      });
      downloadCsvText(`purels-links-${new Date().toISOString().slice(0, 10)}.csv`, content);
    } catch (e) {
      setError(errorText(t, e, "error.export"));
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await api.links.importCsv(await file.text());
      setReport(result);
      setPage(0);
      await load();
      await loadTags();
    } catch (e) {
      setError(errorText(t, e, "error.import"));
    } finally {
      setBusy(false);
      // Clear the picker so re-selecting the same file fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + links.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("links.title")}</p>
          <h1 className="mt-1 text-2xl font-bold">{t("links.title")}</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importCsv(file);
            }}
          />
          <button className="btn-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>{t("links.import")}</button>
          <button className="btn-secondary" disabled={busy} onClick={exportCsv}>{t("links.export")}</button>
          <Link href="/admin/links/new" className="btn-primary">{t("links.create")}</Link>
        </div>
      </div>

      <div className="panel flex flex-wrap gap-3 p-4">
        <input
          className="field-control min-w-[220px] flex-1"
          placeholder={t("links.searchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="field-control w-auto" value={status} onChange={(event) => { setStatus(event.target.value as LinkStatusFilter); setPage(0); }}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
        </select>
        {tags.length > 0 && (
          <select className="field-control w-auto" value={tag} onChange={(event) => { setTag(event.target.value); setPage(0); }}>
            <option value="">{t("links.allTags")}</option>
            {tags.map((item) => <option key={item.name} value={item.name}>{t("links.tagOption", { name: item.name, count: item.links })}</option>)}
          </select>
        )}
        <select className="field-control w-auto" value={sort} onChange={(event) => { setSort(event.target.value as LinkSort); setPage(0); }}>
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      {report && (
        <div className="panel space-y-2 p-4">
          <p className="text-sm">{t("links.imported", { count: report.created })}</p>
          {report.failed > 0 && <p className="text-sm text-red-700">{t("links.importFailed", { count: report.failed })}</p>}
          {report.errors.length > 0 && (
            <ul className="mobile-scroll max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
              {report.errors.map((item) => (
                <li key={item.line}>
                  {item.alias
                    ? t("links.importErrorLineAlias", { line: item.line, alias: item.alias, reason: item.reason })
                    : t("links.importErrorLine", { line: item.line, reason: item.reason })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm">{t("links.selected", { count: selected.size })}</span>
          <select
            className="field-control w-auto"
            value={bulkAction}
            onChange={(event) => { setBulkAction(event.target.value as BulkAction); setBulkValue(""); }}
          >
            {BULK_ACTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
          </select>
          {bulkNeedsValue === "tag" && (
            <input className="field-control w-auto" placeholder={t("links.bulkTagPlaceholder")} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
          )}
          {bulkNeedsValue === "date" && (
            <input type="date" className="field-control w-auto" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
          )}
          <button className="btn-primary" disabled={busy} onClick={runBulk}>{t("links.run")}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setSelected(new Set())}>{t("links.clearSelection")}</button>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="mobile-scroll">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                <th className="w-10 px-5 py-3">
                  <input
                    type="checkbox"
                    aria-label={t("links.selectAll")}
                    checked={links.length > 0 && links.every((link) => selected.has(link.id))}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-5 py-3">{t("links.table.short")}</th>
                <th className="px-5 py-3">{t("links.table.destination")}</th>
                <th className="px-5 py-3">{t("links.table.tags")}</th>
                <th className="px-5 py-3 text-right">{t("links.table.clicks")}</th>
                <th className="px-5 py-3">{t("links.table.redirect")}</th>
                <th className="px-5 py-3">{t("links.table.status")}</th>
                <th className="px-5 py-3 text-right">{t("links.table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {links.map((link) => (
                <tr key={link.id}>
                  <td className="px-5 py-4">
                    <input type="checkbox" aria-label={t("links.selectOne", { alias: link.alias })} checked={selected.has(link.id)} onChange={() => toggleOne(link.id)} />
                  </td>
                  <td className="px-5 py-4 font-medium">
                    {link.domain ? `${link.domain}/` : "/"}
                    {link.alias}
                    {link.title && <span className="mt-0.5 block max-w-[200px] truncate text-xs font-normal text-[var(--muted)]">{link.title}</span>}
                  </td>
                  <td className="max-w-[300px] truncate px-5 py-4 text-[var(--muted)]">{link.destination_url}</td>
                  <td className="px-5 py-4">
                    <div className="flex max-w-[200px] flex-wrap gap-1">
                      {(link.tags || []).map((name) => (
                        <button
                          key={name}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
                          onClick={() => { setTag(name); setPage(0); }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">{link.clicks ?? 0}</td>
                  <td className="px-5 py-4">{link.redirect_code}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusStyle(link.status)}`}>{link.status}</span>
                    {link.last_checked_at && (
                      <span className="mt-1 block text-xs text-[var(--muted)]">{checkLabel(t, link)}</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <Link href={`/admin/links/${link.id}/edit`} className="btn-secondary">{t("common.edit")}</Link>
                      <button className="btn-secondary" onClick={() => setQrLink(link)}>{t("links.qr")}</button>
                      <button className="btn-danger" onClick={() => remove(link.id)}>{t("common.delete")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !links.length && (
            <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">
              {debouncedSearch || status !== "all" || tag ? t("links.emptyFiltered") : t("links.empty")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
        <span>{total === 0 ? t("common.rangeEmpty") : t("common.range", { start: rangeStart, end: rangeEnd, total })}</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>{t("common.previous")}</button>
          <span className="tabular-nums">{t("common.page", { page: page + 1, count: pageCount })}</span>
          <button className="btn-secondary" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>{t("common.next")}</button>
        </div>
      </div>

      <QrDialog link={qrLink} onClose={() => setQrLink(null)} />
    </div>
  );
}
