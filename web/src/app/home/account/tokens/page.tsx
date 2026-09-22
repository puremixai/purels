"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type TokenRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText } from "@/lib/i18n";
import { DeleteButton } from "@/components/ui/rare/delete-button";
import { SettingsSection } from "@/components/settings/settings-page";
import { AccountPage } from "@/components/personal/account-page";

export default function AccountTokensPage() {
  const t = useT();
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<TokenRecord[] | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const user = await api.auth.me();
      const canManage = (user.scopes || []).includes("tokens:manage");
      setAllowed(canManage);
      if (canManage) setTokens(await api.tokens.list());
      else {
        setTokens(null);
        setSecret("");
      }
    } catch (cause) {
      setLoadError(errorText(t, cause, "error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || creating || !name.trim() || secret) return;
    setCreating(true);
    setError("");
    try {
      const result = await api.tokens.create(name.trim());
      setSecret(result.secret);
      setName("");
      await load();
      toast({ kind: "success", title: t("settings.security.tokenCreated") });
    } catch (cause) {
      setError(errorText(t, cause, "error.create"));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!allowed) return;
    setError("");
    try {
      await api.tokens.revoke(id);
      setTokens((current) => current?.filter((token) => token.id !== id) ?? null);
      toast({ kind: "success", title: t("settings.security.tokenRevoked") });
    } catch (cause) {
      setError(errorText(t, cause, "error.revoke"));
      throw cause;
    }
  }

  return (
    <AccountPage title={t("account.tokens")} description={t("account.tokensDescription")}>
      {loadError && (
        <div className="console-alert" role="alert">
          <p>{loadError}</p>
          <button className="btn-secondary mt-3" disabled={loading} onClick={load}>{t("common.retry")}</button>
        </div>
      )}
      {loading && <p className="text-sm text-muted" role="status">{t("common.loading")}</p>}
      {allowed === false && <p className="console-alert" role="alert">{t("account.tokensForbidden")}</p>}
      {allowed && <>
        <SettingsSection title={t("settings.security.tokensTitle")} description={t("settings.security.tokensDescription")}>
          {error && <p className="console-alert" role="alert">{error}</p>}
          {secret && <div className="space-y-3 rounded-lg border border-warning/20 bg-warning-tint p-4 text-sm text-warning" role="status">
            <p className="font-semibold">{t("settings.security.tokenWarning")}</p>
            <code className="block break-all">{secret}</code>
            <button className="btn-secondary" onClick={() => setSecret("")}>{t("account.tokenSaved")}</button>
          </div>}
          <form className="flex flex-wrap items-end gap-3" onSubmit={create}>
            <label className="min-w-0 flex-1 space-y-2 text-sm">
              <span className="block">{t("settings.security.tokenName")}</span>
              <input className="field-control" value={name} onChange={(event) => setName(event.target.value)} disabled={creating || Boolean(secret)} required />
            </label>
            <button className="btn-primary" type="submit" disabled={creating || !name.trim() || Boolean(secret)}>
              {creating ? t("common.saving") : t("settings.security.create")}
            </button>
          </form>
        </SettingsSection>
        <SettingsSection title={t("settings.security.tokenList")}>
          {tokens?.length ? tokens.map((token) => (
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] py-3 first:pt-0 last:border-0 last:pb-0" key={token.id}>
              <div className="min-w-0">
                <p className="break-all font-medium">{token.name}</p>
                <p className="text-sm text-muted">{token.token_prefix}••••</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {(token.scopes || []).map((scope) => <span key={scope} className="rounded bg-canvas px-1.5 py-0.5 text-2xs text-ink-soft">{scope}</span>)}
                </p>
              </div>
              <DeleteButton
                label={t("settings.security.revoke")}
                confirmLabel={t("settings.security.revoke")}
                cancelLabel={t("common.cancel")}
                errorLabel={t("common.actionFailed")}
                onConfirm={() => revoke(token.id)}
              />
            </div>
          )) : tokens && !loading && <p className="console-empty">{t("settings.security.noTokens")}</p>}
        </SettingsSection>
      </>}
    </AccountPage>
  );
}
