"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AuditEntry } from "@/lib/api-client";
import { useLocale, useT } from "@/components/i18n-provider";
import { formatDateTime } from "@/lib/format";
import { errorText, hasMessage, type T } from "@/lib/i18n";
import { RareStatus, type RareStatusTone } from "@/components/rare/rare-status";

const PAGE_SIZE = 20;

// Every action the API records, in the order the filter lists them. A code with
// no entry here — one added in Go and not yet named — renders as the code.
const ACTION_LABELS = [
  "link.create",
  "link.update",
  "link.delete",
  "link.import",
  "link.bulk",
  "token.create",
  "token.revoke",
  "session.login",
  "session.2fa",
  "session.logout",
  "user.register",
  "user.update",
  "user.2fa_enroll",
  "user.2fa_disable",
  "user.2fa_reset",
  "role.update",
  "oidc.create",
  "oidc.update",
  "oidc.delete",
  "analytics.update",
  "captcha.update",
  "runtime_settings.update",
] as const satisfies ReadonlyArray<string>;

function actionLabel(t: T, action: string) {
  const key = `audit.action.${action}`;
  return hasMessage(key) ? t(key) : action;
}

function actionTone(action: string): RareStatusTone {
  if (action.endsWith(".delete") || action.endsWith(".revoke") || action === "session.logout") return "danger";
  if (action.endsWith(".create") || action === "session.login") return "success";
  return "neutral";
}

function describe(entry: AuditEntry) {
  const metadata = entry.metadata || {};
  const parts = Object.entries(metadata)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return parts.join(" · ");
}

export default function AuditPage() {
  const t = useT();
  const locale = useLocale();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.audit.list({ action: action || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      const records = result.entries || [];
      // Deleting entries is not possible, but the trail can shrink if the table
      // is pruned externally; step back rather than showing an empty page.
      if (records.length === 0 && page > 0) {
        setPage((current) => Math.max(0, current - 1));
        return;
      }
      setEntries(records);
      setTotal(result.total || 0);
      setError("");
    } catch (e) {
      setError(errorText(t, e, "audit.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, action, t]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + entries.length);

  return (
    <div className="console-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")} / {t("audit.title")}</p>
          <h1 className="console-page-title">{t("audit.title")}</h1>
        </div>
        <div className="console-actions">
          <label className="sr-only" htmlFor="audit-action">{t("audit.filterLabel")}</label>
          <select id="audit-action" className="field-control w-auto" value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}>
            <option value="">{t("audit.allActions")}</option>
            {ACTION_LABELS.map((value) => <option key={value} value={value}>{actionLabel(t, value)}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="console-alert flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-secondary" onClick={load}>{t("common.retry")}</button>
        </div>
      )}

      <div className="console-panel" aria-busy={loading || undefined}>
        <div className={`mobile-scroll${loading && entries.length ? " opacity-60 transition-opacity" : ""}`}>
          <table className="console-table min-w-[900px]">
            <thead>
              <tr>
                <th>{t("audit.table.time")}</th>
                <th>{t("audit.table.actor")}</th>
                <th>{t("audit.table.action")}</th>
                <th>{t("audit.table.detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loading && !entries.length && Array.from({ length: PAGE_SIZE }, (_, index) => (
                <tr key={`audit-skeleton-${index}`}>
                  <td colSpan={4}><span className="console-skeleton w-2/3" /></td>
                </tr>
              ))}
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap tabular-nums text-[var(--muted)]">{formatDateTime(entry.created_at, locale)}</td>
                  <td className="font-medium">{entry.username || ""}</td>
                  <td>
                    <RareStatus tone={actionTone(entry.action)}>{actionLabel(t, entry.action)}</RareStatus>
                  </td>
                  <td className="max-w-[420px] text-[var(--muted)]">
                    <span className="block truncate">{describe(entry)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !entries.length && (
            <p className="console-empty">
              {action ? t("audit.emptyFiltered") : t("audit.empty")}
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
    </div>
  );
}
