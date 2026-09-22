"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { CopyLinkButton } from "@/components/copy-link-button";
import { QrDialog } from "@/components/qr-dialog";
import { api, BulkAction, BulkLinkInput, ImportReport, LinkListRecord, LinkRecord, LinkSort, LinkStatusFilter, TagStat } from "@/lib/api-client";
import { downloadCsvText } from "@/lib/csv";
import { enumLabel, errorText, type MessageKey, type T } from "@/lib/i18n";
import { parseTags } from "@/lib/tags";
import { DeleteButton } from "@/components/ui/rare/delete-button";
import { GooeyNav } from "@/components/ui/rare/gooey-nav";
import { RareStatus } from "@/components/rare/rare-status";

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

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "disabled") return "warning";
  if (status === "expired") return "danger";
  return "neutral";
}

/** "Check 200" / "Check failed" — only shown once the link has been checked. */
function checkLabel(t: T, link: LinkRecord) {
  if (!link.last_checked_at) return "";
  return link.last_status_code ? t("links.checkOk", { code: link.last_status_code }) : t("links.checkFailed");
}

export default function LinksPage() {
  const t = useT();
  const { toast } = useToast();
  const [links, setLinks] = useState<LinkListRecord[]>([]);
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
    try {
      await api.links.remove(id);
      await load();
      await loadTags();
      toast({ kind: "success", title: t("links.deleted") });
    } catch (e) {
      setError(errorText(t, e, "error.delete"));
      // The row stays put on purpose: it is still there, and so is the delete
      // control that failed. A retried click is the recovery path.
      throw e;
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
      } else {
        toast({ kind: "success", title: t("links.bulkComplete", { count: result.affected }) });
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
      toast({ kind: "success", title: t("links.exported") });
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
      toast({
        kind: result.failed > 0 ? "info" : "success",
        title: t("links.imported", { count: result.created }),
        description: result.failed > 0 ? t("links.importFailed", { count: result.failed }) : undefined,
      });
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
    <div className="console-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")}</p>
          <h1 className="console-page-title">{t("links.title")}</h1>
        </div>
        <div className="console-actions">
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
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>{t("links.import")}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={exportCsv}>{t("links.export")}</button>
          <Link href="/home/links/new" className="btn-primary">{t("links.create")}</Link>
        </div>
      </div>

      <div className="console-toolbar">
        <div className="flex min-w-[220px] flex-1 flex-col">
          <label className="sr-only" htmlFor="link-search">{t("links.searchLabel")}</label>
          <input
            id="link-search"
            className="field-control w-full"
            type="search"
            placeholder={t("links.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <GooeyNav
          size="sm"
          ariaLabel={t("links.table.status")}
          items={STATUS_OPTIONS.map((option) => t(option.labelKey))}
          value={Math.max(0, STATUS_OPTIONS.findIndex((option) => option.value === status))}
          onChange={(index) => { setStatus(STATUS_OPTIONS[index]?.value ?? "all"); setPage(0); }}
        />
        {tags.length > 0 && (
          <div className="flex flex-col">
            <label className="sr-only" htmlFor="link-tag">{t("links.tagFilterLabel")}</label>
            <select id="link-tag" className="field-control w-auto" value={tag} onChange={(event) => { setTag(event.target.value); setPage(0); }}>
              <option value="">{t("links.allTags")}</option>
              {tags.map((item) => <option key={item.name} value={item.name}>{t("links.tagOption", { name: item.name, count: item.links })}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col">
          <label className="sr-only" htmlFor="link-sort">{t("links.sortLabel")}</label>
          <select id="link-sort" className="field-control w-auto" value={sort} onChange={(event) => { setSort(event.target.value as LinkSort); setPage(0); }}>
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="console-alert flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-secondary" onClick={load}>{t("common.retry")}</button>
        </div>
      )}

      {report && (
        <div className="console-panel space-y-2 p-4">
          <p className="text-sm">{t("links.imported", { count: report.created })}</p>
          {report.failed > 0 && <p className="text-sm text-danger">{t("links.importFailed", { count: report.failed })}</p>}
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
        <div className="console-toolbar">
          <span className="text-sm">{t("links.selected", { count: selected.size })}</span>
          <label className="sr-only" htmlFor="link-bulk-action">{t("links.bulkActionLabel")}</label>
          <select
            id="link-bulk-action"
            className="field-control w-auto"
            value={bulkAction}
            onChange={(event) => { setBulkAction(event.target.value as BulkAction); setBulkValue(""); }}
          >
            {BULK_ACTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
          </select>
          {bulkNeedsValue === "tag" && (
            <input className="field-control w-auto" aria-label={t("links.bulkTagPlaceholder")} placeholder={t("links.bulkTagPlaceholder")} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
          )}
          {bulkNeedsValue === "date" && (
            <input type="date" className="field-control w-auto" aria-label={t("links.bulkDateLabel")} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
          )}
          {bulkAction === "delete" ? (
            <DeleteButton
              label={t("common.delete")}
              confirmLabel={t("common.delete")}
              cancelLabel={t("common.cancel")}
              errorLabel={t("common.actionFailed")}
              disabled={busy}
              onConfirm={runBulk}
            />
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={runBulk}>{t("links.run")}</button>
          )}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setSelected(new Set())}>{t("links.clearSelection")}</button>
        </div>
      )}

      <div className="console-panel" aria-busy={loading || undefined}>
        <div className={`mobile-scroll${loading && links.length ? " opacity-60 transition-opacity" : ""}`}>
          <table className="console-table min-w-[1020px]">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label={t("links.selectAll")}
                    checked={links.length > 0 && links.every((link) => selected.has(link.id))}
                    onChange={toggleAll}
                  />
                </th>
                <th>{t("links.table.short")}</th>
                <th>{t("links.table.destination")}</th>
                <th>{t("links.table.tags")}</th>
                <th className="text-right">{t("links.table.clicks")}</th>
                <th>{t("links.table.redirect")}</th>
                <th>{t("links.table.status")}</th>
                <th className="text-right">{t("links.table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loading && !links.length && Array.from({ length: PAGE_SIZE }, (_, index) => (
                <tr key={`link-skeleton-${index}`}>
                  <td colSpan={8}><span className="console-skeleton w-2/3" /></td>
                </tr>
              ))}
              {links.map((link) => (
                <tr key={link.id}>
                  <td>
                    <input type="checkbox" aria-label={t("links.selectOne", { alias: link.alias })} checked={selected.has(link.id)} onChange={() => toggleOne(link.id)} />
                  </td>
                  <td>
                    <div className="max-w-[320px] space-y-1">
                      <CopyLinkButton value={link.short_url} compact />
                      {link.title && <span className="mt-0.5 block max-w-[200px] truncate text-xs font-normal text-[var(--muted)]">{link.title}</span>}
                    </div>
                  </td>
                  <td className="max-w-[300px] truncate text-[var(--muted)]">{link.destination_url}</td>
                  <td>
                    <div className="flex max-w-[200px] flex-wrap gap-1">
                      {(link.tags || []).map((name) => (
                        <button
                          key={name}
                          className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-soft hover:bg-line"
                          onClick={() => { setTag(name); setPage(0); }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{link.clicks ?? 0}</td>
                  <td>{link.redirect_code}</td>
                  <td>
                    <RareStatus tone={statusTone(link.status)}>{enumLabel(t, "statusFilter", link.status)}</RareStatus>
                    {link.last_checked_at && (
                      <span className="mt-1 block text-xs text-[var(--muted)]">{checkLabel(t, link)}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Link href={`/home/links/${link.id}/edit`} className="btn-secondary">{t("common.edit")}</Link>
                      <button type="button" className="btn-secondary" onClick={() => setQrLink(link)}>{t("links.qr")}</button>
                      <DeleteButton
                        label={t("common.delete")}
                        confirmLabel={t("common.delete")}
                        cancelLabel={t("common.cancel")}
                        errorLabel={t("common.actionFailed")}
                        onConfirm={() => remove(link.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !links.length && (
            <p className="console-empty">
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
