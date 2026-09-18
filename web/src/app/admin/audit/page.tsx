"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, AuditEntry } from "@/lib/api-client";

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, string> = {
  "link.create": "创建链接",
  "link.update": "更新链接",
  "link.delete": "删除链接",
  "link.import": "导入链接",
  "link.bulk": "批量操作",
  "token.create": "创建 Token",
  "token.revoke": "撤销 Token",
  "session.login": "登录",
  "session.logout": "退出登录",
  "user.register": "注册账号",
  "user.update": "更新用户",
  "oidc.create": "新增登录方式",
  "oidc.update": "修改登录方式",
  "oidc.delete": "删除登录方式",
  "captcha.update": "修改注册保护",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action;
}

function actionStyle(action: string) {
  if (action.endsWith(".delete") || action.endsWith(".revoke") || action === "session.logout") return "bg-red-50 text-red-700";
  if (action.endsWith(".create") || action === "session.login") return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

function describe(entry: AuditEntry) {
  const metadata = entry.metadata || {};
  const parts = Object.entries(metadata)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return parts.join(" · ");
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AuditPage() {
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
      setError(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + entries.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">工作台 / 操作日志</p>
          <h1 className="mt-1 text-2xl font-bold">操作日志</h1>
        </div>
        <select className="field-control w-auto" value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}>
          <option value="">全部动作</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <div className="panel overflow-hidden">
        <div className="mobile-scroll">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3">时间</th>
                <th className="px-5 py-3">操作人</th>
                <th className="px-5 py-3">动作</th>
                <th className="px-5 py-3">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[var(--muted)]">{formatTime(entry.created_at)}</td>
                  <td className="px-5 py-4 font-medium">{entry.username || "—"}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${actionStyle(entry.action)}`}>{actionLabel(entry.action)}</span>
                  </td>
                  <td className="max-w-[420px] px-5 py-4 text-[var(--muted)]">
                    <span className="block truncate">{describe(entry) || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !entries.length && (
            <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">
              {action ? "该动作暂无记录。" : "暂无操作记录。"}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
        <span>{total === 0 ? "共 0 条" : `第 ${rangeStart}–${rangeEnd} 条，共 ${total} 条`}</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>上一页</button>
          <span className="tabular-nums">第 {page + 1} / {pageCount} 页</span>
          <button className="btn-secondary" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </div>
      </div>
    </div>
  );
}
