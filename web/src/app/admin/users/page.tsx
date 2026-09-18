"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AccountRecord, ApiError, roleLabels, RoleRecord } from "@/lib/api-client";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function UsersPage() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, me, roleList] = await Promise.all([
        api.users.list(),
        api.auth.me().catch(() => null),
        // A role list is only reachable with roles:manage, so a user
        // administrator without it still gets a working page.
        api.roles.list().catch(() => [] as RoleRecord[]),
      ]);
      setAccounts(users);
      setCurrentId(me?.id || "");
      setRoles(roleList);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, input: { role?: string; disabled?: boolean }) {
    setBusy(id);
    setError("");
    try {
      await api.users.update(id, input);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "更新失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">工作台 / 用户管理</p>
        <h1 className="mt-1 text-2xl font-bold">用户管理</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <div className="panel overflow-hidden">
        <div className="mobile-scroll">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3">用户名</th>
                <th className="px-5 py-3">角色</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">注册时间</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {accounts.map((account) => {
                const isSelf = account.id === currentId;
                const disabled = busy === account.id;
                return (
                  <tr key={account.id}>
                    <td className="px-5 py-4 font-medium">
                      {account.username}
                      {isSelf && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">当前账号</span>}
                    </td>
                    <td className="px-5 py-4">
                      <select
                        className="field-control w-auto"
                        value={account.role}
                        disabled={isSelf || disabled}
                        onChange={(event) => update(account.id, { role: event.target.value })}
                      >
                        {(roles.length ? roles : [{ name: account.role, scopes: [], unrestricted: false }]).map((role) => (
                          <option key={role.name} value={role.name}>{roleLabels[role.name] || role.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs ${account.disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {account.disabled ? "已禁用" : "正常"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[var(--muted)]">{formatTime(account.created_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        className="btn-secondary"
                        disabled={isSelf || disabled}
                        onClick={() => update(account.id, { disabled: !account.disabled })}
                      >
                        {account.disabled ? "启用" : "禁用"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !accounts.length && (
            <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">暂无用户。</p>
          )}
        </div>
      </div>
    </div>
  );
}
