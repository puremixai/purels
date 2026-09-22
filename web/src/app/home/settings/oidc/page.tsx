"use client";

import { useCallback, useEffect, useState } from "react";
import { api, OIDCProvider, OIDCProviderInput } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText, type MessageKey, type T } from "@/lib/i18n";
import { buildOIDCCallbackURL } from "@/lib/oidc-callback";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsAccess } from "@/components/settings/settings-access";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-page";

const DEFAULT_SCOPES = "openid profile email";

/** The editable fields of one provider. The slug is not among them. */
type Draft = {
  display_name: string;
  issuer: string;
  client_id: string;
  /** Write-only. Empty means "keep the stored one", never "clear it". */
  client_secret: string;
  scopes: string;
  auto_provision: boolean;
  enabled: boolean;
};

type NewProvider = Draft & { slug: string };

function toDraft(provider: OIDCProvider): Draft {
  return {
    display_name: provider.display_name,
    issuer: provider.issuer,
    client_id: provider.client_id,
    client_secret: "",
    scopes: provider.scopes.join(" "),
    auto_provision: provider.auto_provision,
    enabled: provider.enabled,
  };
}

const emptyNew: NewProvider = {
  slug: "",
  display_name: "",
  issuer: "",
  client_id: "",
  client_secret: "",
  scopes: DEFAULT_SCOPES,
  auto_provision: true,
  enabled: true,
};

/** The scope field is free text, so both separators an operator might use work. */
function parseScopes(value: string) {
  return value.split(/[\s,]+/).filter(Boolean);
}

/**
 * An account without oidc:manage gets a 403 here. It is rendered as a permission
 * boundary rather than as the API's own wording, so a page that is merely out of
 * reach does not look like a page that broke.
 */
function describeError(t: T, e: unknown, fallback: MessageKey) {
  return errorText(t, e, fallback, { 403: "settings.oidc.noPermission" });
}

export default function OIDCSettingsPage() {
  const t = useT();
  const { toast } = useToast();
  const [providers, setProviders] = useState<OIDCProvider[]>([]);
  const [redirectBase, setRedirectBase] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [creating, setCreating] = useState<NewProvider>(emptyNew);
  const [confirming, setConfirming] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.oidc.list();
      const list = result.providers || [];
      setProviders(list);
      setRedirectBase(result.redirect_base || "");
      setDrafts(Object.fromEntries(list.map((provider) => [provider.id, toDraft(provider)])));
      setError("");
    } catch (e) {
      setError(describeError(t, e, "error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function edit(id: string, change: (draft: Draft) => Draft) {
    setNotice("");
    setDrafts((current) => ({ ...current, [id]: change(current[id]) }));
  }

  function dirty(provider: OIDCProvider) {
    const draft = drafts[provider.id];
    if (!draft) return false;
    const current = toDraft(provider);
    return (
      draft.display_name !== current.display_name ||
      draft.issuer !== current.issuer ||
      draft.client_id !== current.client_id ||
      draft.scopes !== current.scopes ||
      draft.auto_provision !== current.auto_provision ||
      draft.enabled !== current.enabled ||
      draft.client_secret !== ""
    );
  }

  async function save(provider: OIDCProvider) {
    const draft = drafts[provider.id];
    if (!draft) return;
    setBusy(provider.id);
    setError("");
    setNotice("");
    try {
      // The slug is deliberately absent: the API refuses to move a provider,
      // because the callback URL registered at the IdP names it.
      const input: OIDCProviderInput = {
        display_name: draft.display_name,
        issuer: draft.issuer,
        client_id: draft.client_id,
        scopes: parseScopes(draft.scopes),
        auto_provision: draft.auto_provision,
        enabled: draft.enabled,
      };
      // Omitted entirely when nothing was typed, so an edit that does not touch
      // the secret cannot clear it.
      if (draft.client_secret !== "") input.client_secret = draft.client_secret;
      await api.oidc.update(provider.id, input);
      await load();
      setNotice(t("settings.oidc.saved", { name: draft.display_name || provider.slug }));
      toast({ kind: "success", title: t("settings.oidc.saved", { name: draft.display_name || provider.slug }) });
    } catch (e) {
      setError(describeError(t, e, "error.save"));
    } finally {
      setBusy("");
    }
  }

  async function remove(provider: OIDCProvider) {
    setBusy(provider.id);
    setError("");
    setNotice("");
    try {
      await api.oidc.remove(provider.id);
      setConfirming("");
      await load();
      setNotice(t("settings.oidc.deleted", { name: provider.display_name || provider.slug }));
      toast({ kind: "success", title: t("settings.oidc.deleted", { name: provider.display_name || provider.slug }) });
    } catch (e) {
      setError(describeError(t, e, "error.save"));
    } finally {
      setBusy("");
    }
  }

  async function create() {
    setBusy("new");
    setError("");
    setNotice("");
    try {
      const input: OIDCProviderInput = {
        slug: creating.slug,
        display_name: creating.display_name,
        issuer: creating.issuer,
        client_id: creating.client_id,
        scopes: parseScopes(creating.scopes),
        auto_provision: creating.auto_provision,
        enabled: creating.enabled,
      };
      if (creating.client_secret !== "") input.client_secret = creating.client_secret;
      await api.oidc.create(input);
      setCreating(emptyNew);
      await load();
      setNotice(t("settings.oidc.created"));
      toast({ kind: "success", title: t("settings.oidc.created") });
    } catch (e) {
      setError(describeError(t, e, "error.create"));
    } finally {
      setBusy("");
    }
  }

  const canCreate = creating.slug !== "" && creating.display_name !== "" && creating.issuer !== "" && creating.client_id !== "";
  const newCallback = buildOIDCCallbackURL(redirectBase, creating.slug);

  return (
    <SettingsPage
      group={t("settings.registration.title")}
      title={t("settings.oidc.title")}
      description={t("settings.oidc.description")}
    >
      <SettingsAccess>{scopes => <SettingsTabs group="registration" scopes={scopes} />}</SettingsAccess>

      {error && <p className="console-alert" role="alert">{error}</p>}
      {notice && <p className="console-notice" role="status">{notice}</p>}
      {!loading && !redirectBase && (
        <p className="console-alert border-warning/30 bg-warning-tint text-warning" role="status">
          {t("settings.oidc.noRedirectBase")}
        </p>
      )}

      {loading && !providers.length && <span className="console-skeleton w-32" role="status" aria-label={t("common.loading")} />}

      {!loading && providers.length > 0 && <p className="text-sm text-[var(--muted)]">{t("settings.oidc.providerListDescription")}</p>}

      {providers.map((provider) => {
        const draft = drafts[provider.id] || toDraft(provider);
        const callback = buildOIDCCallbackURL(redirectBase, provider.slug);
        return (
          <SettingsSection
            key={provider.id}
            title={provider.display_name}
            status={<RareStatus tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? t("settings.oidc.enabled") : t("settings.oidc.disabled")}</RareStatus>}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary" disabled={!dirty(provider) || busy === provider.id} onClick={() => save(provider)}>
                  {busy === provider.id ? t("common.saving") : t("common.save")}
                </button>
                {confirming === provider.id ? (
                  <>
                    <button className="btn-danger" disabled={busy === provider.id} onClick={() => remove(provider)}>
                      {t("settings.oidc.confirmDelete")}
                    </button>
                    <button className="btn-secondary" disabled={busy === provider.id} onClick={() => setConfirming("")}>
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <button className="btn-secondary" disabled={busy === provider.id} onClick={() => setConfirming(provider.id)}>
                    {t("common.delete")}
                  </button>
                )}
              </div>
            )}
          >
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[var(--ink-soft)]">{provider.slug}</code>
              <span>{t("settings.oidc.boundAccounts", { count: provider.identity_count })}</span>
            </div>

            {confirming === provider.id && (
              <p className="console-alert">
                {t("settings.oidc.deleteWarning")}
                {provider.identity_count > 0 ? ` ${t("settings.oidc.boundAccounts", { count: provider.identity_count })}` : ""}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">{t("settings.oidc.name")}</span>
                <input
                  className="field-control"
                  value={draft.display_name}
                  onChange={(e) => edit(provider.id, (current) => ({ ...current, display_name: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--ink)]">{t("settings.oidc.issuer")}</span>
                <input
                  className="field-control"
                  value={draft.issuer}
                  onChange={(e) => edit(provider.id, (current) => ({ ...current, issuer: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--ink)]">{t("settings.oidc.clientId")}</span>
                <input
                  className="field-control"
                  value={draft.client_id}
                  onChange={(e) => edit(provider.id, (current) => ({ ...current, client_id: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--ink)]">{t("settings.oidc.clientSecret")}{provider.has_secret ? t("settings.leaveBlank") : ""}</span>
                <input
                  className="field-control"
                  type="password"
                  autoComplete="new-password"
                  placeholder={provider.has_secret ? t("settings.secretSet") : t("settings.secretUnset")}
                  value={draft.client_secret}
                  onChange={(e) => edit(provider.id, (current) => ({ ...current, client_secret: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--ink)]">{t("settings.oidc.scopes")}</span>
                <input
                  className="field-control"
                  value={draft.scopes}
                  onChange={(e) => edit(provider.id, (current) => ({ ...current, scopes: e.target.value }))}
                />
              </label>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.auto_provision}
                    onChange={() => edit(provider.id, (current) => ({ ...current, auto_provision: !current.auto_provision }))}
                  />
                  {t("settings.oidc.autoProvision")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.enabled}
                    onChange={() => edit(provider.id, (current) => ({ ...current, enabled: !current.enabled }))}
                  />
                  {t("settings.oidc.enable")}
                </label>
              </div>
            </div>

            {callback && (
              <div className="space-y-1 border-t border-[var(--line)] pt-4 text-sm">
                <p className="text-[var(--muted)]">{t("settings.oidc.callback")}</p>
                <code className="block break-all rounded bg-canvas-alt px-3 py-2 font-mono text-xs">{callback}</code>
              </div>
            )}
          </SettingsSection>
        );
      })}

      <SettingsSection title={t("settings.oidc.newTitle")} description={t("settings.oidc.newDescription")}>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted)]">{t("settings.oidc.slug")}</span>
            <input
              className="field-control"
              placeholder="dex"
              value={creating.slug}
              onChange={(e) => setCreating((current) => ({ ...current, slug: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted)]">{t("settings.oidc.name")}</span>
            <input
              className="field-control"
              placeholder={t("settings.oidc.namePlaceholder")}
              value={creating.display_name}
              onChange={(e) => setCreating((current) => ({ ...current, display_name: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--ink)]">{t("settings.oidc.issuer")}</span>
            <input
              className="field-control"
              placeholder="https://idp.example.com"
              value={creating.issuer}
              onChange={(e) => setCreating((current) => ({ ...current, issuer: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--ink)]">{t("settings.oidc.clientId")}</span>
            <input
              className="field-control"
              value={creating.client_id}
              onChange={(e) => setCreating((current) => ({ ...current, client_id: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted)]">{t("settings.oidc.clientSecretNew")}</span>
            <input
              className="field-control"
              type="password"
              autoComplete="new-password"
              value={creating.client_secret}
              onChange={(e) => setCreating((current) => ({ ...current, client_secret: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--ink)]">{t("settings.oidc.scopes")}</span>
            <input
              className="field-control"
              value={creating.scopes}
              onChange={(e) => setCreating((current) => ({ ...current, scopes: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[var(--muted)]">{t("settings.oidc.callback")}</span>
            <input className="field-control font-mono text-xs" readOnly value={newCallback} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={creating.auto_provision}
              onChange={() => setCreating((current) => ({ ...current, auto_provision: !current.auto_provision }))}
            />
            {t("settings.oidc.autoProvision")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={creating.enabled}
              onChange={() => setCreating((current) => ({ ...current, enabled: !current.enabled }))}
            />
            {t("settings.oidc.enable")}
          </label>
          <button className="btn-primary ml-auto" disabled={!canCreate || busy === "new"} onClick={create}>
            {busy === "new" ? t("settings.oidc.adding") : t("settings.oidc.add")}
          </button>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
