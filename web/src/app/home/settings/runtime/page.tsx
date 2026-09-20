"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type RuntimeSettings, type RuntimeSettingsInput } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { errorText, type MessageKey, type T } from "@/lib/i18n";

const emptyDraft: RuntimeSettingsInput = {
  alias_mode: "random",
  unique_urls: true,
  registration_enabled: true,
  count_bots: false,
  forward_query: true,
  fallback_url: "",
  auto_prune_expired: false,
  prune_grace_seconds: 60 * 60 * 24 * 30,
  max_links_per_user: 1000,
  destination_denylist: [],
  short_domains: [],
  health_check_enabled: false,
  health_check_interval_seconds: 60 * 60 * 24,
  rate_limit_enabled: true,
  rate_limit_login: 10,
  rate_limit_api: 120,
  rate_limit_redirect: 600,
  rate_limit_register: 5,
  rate_limit_2fa: 10,
  rate_limit_oidc: 30,
};

function toDraft(settings: RuntimeSettings): RuntimeSettingsInput {
  const { revision, updated_at, ...input } = settings;
  void revision;
  void updated_at;
  return {
    ...input,
    destination_denylist: [...input.destination_denylist],
    short_domains: [...input.short_domains],
  };
}

function listText(values: string[]) {
  return values.join("\n");
}

function parseList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function describeError(t: T, error: unknown, fallback: MessageKey) {
  return errorText(t, error, fallback, { 403: "settings.runtime.noPermission" });
}

export default function RuntimeSettingsPage() {
  const t = useT();
  const [saved, setSaved] = useState<RuntimeSettingsInput>(emptyDraft);
  const [draft, setDraft] = useState<RuntimeSettingsInput>(emptyDraft);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await api.runtimeSettings.get();
      const next = toDraft(settings);
      setSaved(next);
      setDraft(next);
      setRevision(settings.revision);
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

  function edit(change: Partial<RuntimeSettingsInput>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...change }));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const settings = await api.runtimeSettings.update(draft);
      const next = toDraft(settings);
      setSaved(next);
      setDraft(next);
      setRevision(settings.revision);
      setNotice(t("settings.saved"));
    } catch (e) {
      setError(describeError(t, e, "error.save"));
    } finally {
      setBusy(false);
    }
  }

  function numberField(field: keyof RuntimeSettingsInput, labelKey: MessageKey, min = 0) {
    const value = draft[field];
    if (typeof value !== "number") return null;
    return (
      <label className="space-y-1 text-sm">
        <span className="text-[var(--muted)]">{t(labelKey)}</span>
        <input
          className="field-control"
          type="number"
          min={min}
          value={value}
          onChange={(event) => edit({ [field]: Math.max(min, Number(event.target.value) || 0) } as Partial<RuntimeSettingsInput>)}
        />
      </label>
    );
  }

  function toggle(field: keyof RuntimeSettingsInput, labelKey: MessageKey) {
    return (
      <label className="flex items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-3 text-sm">
        <input
          type="checkbox"
          checked={Boolean(draft[field])}
          onChange={(event) => edit({ [field]: event.target.checked } as Partial<RuntimeSettingsInput>)}
        />
        <span>{t(labelKey)}</span>
      </label>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("settings.runtime.title")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("settings.runtime.title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("settings.runtime.description")}</p>
      </div>

      {error && <p className="rounded-lg bg-danger-tint px-4 py-3 text-danger">{error}</p>}
      {notice && <p className="rounded-lg bg-success-tint px-4 py-3 text-success">{notice}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>}

      {!loading && (
        <div className="space-y-5">
          <section className="panel space-y-4 p-6">
            <div>
              <h2 className="font-semibold">{t("settings.runtime.linksTitle")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("settings.runtime.linksDescription")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">{t("settings.runtime.aliasMode")}</span>
                <select className="field-control" value={draft.alias_mode} onChange={(event) => edit({ alias_mode: event.target.value as RuntimeSettingsInput["alias_mode"] })}>
                  <option value="random">{t("settings.runtime.aliasRandom")}</option>
                  <option value="sequential">{t("settings.runtime.aliasSequential")}</option>
                </select>
              </label>
              {numberField("max_links_per_user", "settings.runtime.maxLinks")}
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-[var(--muted)]">{t("settings.runtime.fallbackUrl")}</span>
                <input className="field-control" value={draft.fallback_url} placeholder="https://example.com/not-found" onChange={(event) => edit({ fallback_url: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">{t("settings.runtime.shortDomains")}</span>
                <textarea className="field-control min-h-24" value={listText(draft.short_domains)} placeholder="go.example.com" onChange={(event) => edit({ short_domains: parseList(event.target.value) })} />
                <span className="text-xs text-[var(--muted)]">{t("settings.runtime.hostHelp")}</span>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--muted)]">{t("settings.runtime.denylist")}</span>
                <textarea className="field-control min-h-24" value={listText(draft.destination_denylist)} placeholder="localhost\n169.254.169.254" onChange={(event) => edit({ destination_denylist: parseList(event.target.value) })} />
                <span className="text-xs text-[var(--muted)]">{t("settings.runtime.hostHelp")}</span>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {toggle("unique_urls", "settings.runtime.uniqueUrls")}
              {toggle("registration_enabled", "settings.runtime.registration")}
              {toggle("forward_query", "settings.runtime.forwardQuery")}
              {toggle("count_bots", "settings.runtime.countBots")}
            </div>
          </section>

          <section className="panel space-y-4 p-6">
            <div>
              <h2 className="font-semibold">{t("settings.runtime.jobsTitle")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("settings.runtime.jobsDescription")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField("prune_grace_seconds", "settings.runtime.pruneGrace")}
              {numberField("health_check_interval_seconds", "settings.runtime.healthInterval", 1)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {toggle("auto_prune_expired", "settings.runtime.autoPrune")}
              {toggle("health_check_enabled", "settings.runtime.healthCheck")}
            </div>
          </section>

          <section className="panel space-y-4 p-6">
            <div>
              <h2 className="font-semibold">{t("settings.runtime.rateTitle")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("settings.runtime.rateDescription")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {numberField("rate_limit_login", "settings.runtime.rateLogin")}
              {numberField("rate_limit_register", "settings.runtime.rateRegister")}
              {numberField("rate_limit_2fa", "settings.runtime.rate2fa")}
              {numberField("rate_limit_oidc", "settings.runtime.rateOidc")}
              {numberField("rate_limit_api", "settings.runtime.rateApi")}
              {numberField("rate_limit_redirect", "settings.runtime.rateRedirect")}
            </div>
            {toggle("rate_limit_enabled", "settings.runtime.rateEnabled")}
          </section>

          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-[var(--muted)]">{t("settings.runtime.revision", { revision })}</span>
            <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
