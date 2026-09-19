"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AccountRecord, RoleRecord } from "@/lib/api-client";
import { useLocale, useT } from "@/components/i18n-provider";
import { errorText, hasMessage, type Locale, type T } from "@/lib/i18n";

function roleLabel(t: T, name: string) {
  const key = `role.${name}`;
  return hasMessage(key) ? t(key) : name;
}

function formatTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { hour12: false });
}

export default function UsersPage() {
  const t = useT();
  const locale = useLocale();
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
      setError(errorText(t, e, "error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setError(errorText(t, e, "error.update"));
    } finally {
      setBusy("");
    }
  }

  // The only way back in after the encryption key is lost or changed, so it
  // deliberately asks the target for nothing.
  async function resetMfa(id: string) {
    setBusy(id);
    setError("");
    try {
      await api.users.resetMfa(id);
      await load();
    } catch (e) {
      setError(errorText(t, e, "error.reset"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("users.title")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("users.title")}</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <div className="panel overflow-hidden">
        <div className="mobile-scroll">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3">{t("users.table.username")}</th>
                <th className="px-5 py-3">{t("users.table.role")}</th>
                <th className="px-5 py-3">{t("users.table.status")}</th>
                <th className="px-5 py-3">{t("users.table.mfa")}</th>
                <th className="px-5 py-3">{t("users.table.created")}</th>
                <th className="px-5 py-3 text-right">{t("users.table.actions")}</th>
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
                      {isSelf && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{t("users.self")}</span>}
                    </td>
                    <td className="px-5 py-4">
                      <select
                        className="field-control w-auto"
                        value={account.role}
                        disabled={isSelf || disabled}
                        onChange={(event) => update(account.id, { role: event.target.value })}
                      >
                        {(roles.length ? roles : [{ name: account.role, scopes: [], unrestricted: false }]).map((role) => (
                          <option key={role.name} value={role.name}>{roleLabel(t, role.name)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs ${account.disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {account.disabled ? t("users.status.disabled") : t("users.status.active")}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${account.mfa_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {account.mfa_enabled ? t("users.mfa.enabled") : t("users.mfa.disabled")}
                        </span>
                        {account.mfa_enabled && (
                          <button className="text-xs text-[var(--brand)] hover:underline" disabled={disabled} onClick={() => resetMfa(account.id)}>{t("users.resetMfa")}</button>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[var(--muted)]">{formatTime(account.created_at, locale)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        className="btn-secondary"
                        disabled={isSelf || disabled}
                        onClick={() => update(account.id, { disabled: !account.disabled })}
                      >
                        {account.disabled ? t("users.enable") : t("users.disable")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !accounts.length && (
            <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">{t("users.empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
