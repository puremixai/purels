"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AccountRecord, RoleRecord } from "@/lib/api-client";
import { useLocale, useT } from "@/components/i18n-provider";
import { formatDateTime } from "@/lib/format";
import { errorText, hasMessage, type T } from "@/lib/i18n";
import { RareDialog } from "@/components/ui/rare/dialog";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsAccess } from "@/components/settings/settings-access";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-page";

function roleLabel(t: T, name: string) {
  const key = `role.${name}`;
  return hasMessage(key) ? t(key) : name;
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
  const [mfaTarget, setMfaTarget] = useState<AccountRecord | null>(null);
  const [mfaError, setMfaError] = useState("");

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
  // deliberately asks the target for nothing — which is exactly why it asks the
  // administrator instead. A click that takes someone's second factor away has
  // to name whose, before it happens.
  async function resetMfa(id: string) {
    setBusy(id);
    setMfaError("");
    try {
      await api.users.resetMfa(id);
      setMfaTarget(null);
      await load();
    } catch (e) {
      // The dialog stays open: the reason the reset failed is the reason the
      // administrator is still standing here.
      setMfaError(errorText(t, e, "error.reset"));
    } finally {
      setBusy("");
    }
  }

  return (
    <SettingsPage
      group={t("nav.group.access")}
      title={t("users.title")}
      description={t("settings.home.usersDescription")}
    >
      <SettingsAccess>{scopes => <SettingsTabs group="access" scopes={scopes} />}</SettingsAccess>

      {error && (
        <div className="console-alert flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-secondary" onClick={load}>{t("common.retry")}</button>
        </div>
      )}

      <SettingsSection title={t("users.directoryTitle")} description={t("users.directoryDescription")}>
        <div className="mobile-scroll">
          <table className="console-table min-w-[980px]">
            <thead>
              <tr>
                <th>{t("users.table.username")}</th>
                <th>{t("users.table.source")}</th>
                <th>{t("users.table.role")}</th>
                <th>{t("users.table.status")}</th>
                <th>{t("users.table.mfa")}</th>
                <th>{t("users.table.created")}</th>
                <th className="text-right">{t("users.table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loading && !accounts.length && Array.from({ length: 5 }, (_, index) => (
                <tr key={`user-skeleton-${index}`}>
                  <td colSpan={7}><span className="console-skeleton w-2/3" /></td>
                </tr>
              ))}
              {accounts.map((account) => {
                const isSelf = account.id === currentId;
                const disabled = busy === account.id;
                return (
                  <tr key={account.id}>
                    <td className="font-medium">
                      {account.username}
                      {isSelf && <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-2xs text-muted">{t("users.self")}</span>}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <RareStatus tone="neutral">{account.auth_source === "oidc" ? t("users.source.oidc") : t("users.source.password")}</RareStatus>
                        {account.auth_source === "oidc" && account.auth_provider && (
                          <span className="text-xs text-[var(--muted)]">{account.auth_provider}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <select
                        aria-label={t("users.table.role")}
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
                    <td>
                      <RareStatus tone={account.disabled ? "danger" : "success"}>
                        {account.disabled ? t("users.status.disabled") : t("users.status.active")}
                      </RareStatus>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <RareStatus tone={account.mfa_enabled ? "success" : "neutral"}>
                          {account.mfa_enabled ? t("users.mfa.enabled") : t("users.mfa.disabled")}
                        </RareStatus>
                        {account.mfa_enabled && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--brand-ink)] hover:underline"
                            disabled={disabled}
                            onClick={() => { setMfaError(""); setMfaTarget(account); }}
                          >
                            {t("users.resetMfa")}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-[var(--muted)]">{formatDateTime(account.created_at, locale)}</td>
                    <td className="text-right">
                      <button
                        type="button"
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
            <p className="console-empty">{t("users.empty")}</p>
          )}
        </div>
      </SettingsSection>

      <RareDialog
        open={Boolean(mfaTarget)}
        title={t("users.resetMfaTitle")}
        description={mfaTarget ? t("users.resetMfaSubject", { username: mfaTarget.username }) : undefined}
        onClose={() => setMfaTarget(null)}
        footer={<>
          <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => setMfaTarget(null)}>{t("common.cancel")}</button>
          <button type="button" className="btn-danger" disabled={Boolean(busy)} onClick={() => mfaTarget && resetMfa(mfaTarget.id)}>
            {busy ? t("common.saving") : t("users.resetMfaConfirm")}
          </button>
        </>}
      >
        <p className="text-sm text-[var(--muted)]">{t("users.resetMfaHint")}</p>
        {mfaError && <p className="console-alert mt-3" role="alert">{mfaError}</p>}
      </RareDialog>
    </SettingsPage>
  );
}
