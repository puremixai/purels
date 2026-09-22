"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type RuntimeSettings, type RuntimeSettingsInput } from "@/lib/api-client";
import { errorText, type MessageKey } from "@/lib/i18n";
import { runtimeChanges, runtimeDraft, runtimeGroups, type RuntimeDraft, type RuntimeGroup } from "@/lib/runtime-settings-form";
import { useSettingsTranslator } from "./use-settings-translator";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { DurationField } from "@/components/rare/duration-field";
import { SettingsSection } from "./settings-page";
import { useSettingsDirty } from "./settings-draft-guard";

const labels: Record<keyof RuntimeSettingsInput, MessageKey> = {
  alias_mode: "settings.runtime.aliasMode", unique_urls: "settings.runtime.uniqueUrls",
  registration_enabled: "settings.runtime.registration", count_bots: "settings.runtime.countBots",
  forward_query: "settings.runtime.forwardQuery", fallback_url: "settings.runtime.fallbackUrl",
  auto_prune_expired: "settings.runtime.autoPrune", prune_grace_seconds: "settings.runtime.pruneGrace",
  max_links_per_user: "settings.runtime.maxLinks", destination_denylist: "settings.runtime.denylist",
  short_domains: "settings.runtime.shortDomains", health_check_enabled: "settings.runtime.healthCheck",
  health_check_interval_seconds: "settings.runtime.healthInterval", rate_limit_enabled: "settings.runtime.rateEnabled",
  rate_limit_login: "settings.runtime.rateLogin", rate_limit_register: "settings.runtime.rateRegister",
  rate_limit_2fa: "settings.runtime.rate2fa", rate_limit_oidc: "settings.runtime.rateOidc",
  rate_limit_api: "settings.runtime.rateApi", rate_limit_redirect: "settings.runtime.rateRedirect",
};
const titles: Record<RuntimeGroup, MessageKey> = {
  creation: "settings.links.creation", redirects: "settings.links.redirects", maintenance: "settings.links.maintenance",
  registration: "settings.registration.local", traffic: "settings.traffic.title", statistics: "settings.statistics.title",
};

export function RuntimeForm({ group }: { group: RuntimeGroup }) {
  const t = useT();
  const translate = useSettingsTranslator();
  const { toast } = useToast();
  const [saved, setSaved] = useState<RuntimeSettings | null>(null);
  const [draft, setDraft] = useState<RuntimeDraft>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(runtimeDraft(saved, group));
  useSettingsDirty(dirty);

  const load = useCallback(async () => {
    setLoading(true); setSaved(null); setError(""); setNotice(""); setConflict(false);
    try {
      const next = await api.runtimeSettings.get();
      setSaved(next); setDraft(runtimeDraft(next, group));
    } catch (e) { setError(errorText(translate, e, "error.load", { 403: "settings.form.forbidden" })); }
    finally { setLoading(false); }
  }, [group, translate]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!loading && window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" });
  }, [loading]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || busy) return;
    setError(""); setNotice("");
    let changes: Partial<RuntimeSettingsInput>;
    try { changes = runtimeChanges(saved, draft, group); }
    catch { setError(t("settings.form.invalidNumber")); return; }
    if (!Object.keys(changes).length) { setDraft(runtimeDraft(saved, group)); return; }
    setBusy(true);
    try {
      const next = await api.runtimeSettings.patch(saved.revision, changes);
      setSaved(next); setDraft(runtimeDraft(next, group)); setConflict(false);
      setNotice(t("settings.saved")); toast({ kind: "success", title: t("settings.saved") });
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 409);
      setError(errorText(t, e, "error.save", { 403: "settings.form.forbidden", 409: "settings.form.conflict" }));
    } finally { setBusy(false); }
  }

  function edit(key: keyof RuntimeSettingsInput, value: string | boolean) {
    setNotice(""); setDraft(current => ({ ...current, [key]: value }));
  }

  function field(key: keyof RuntimeSettingsInput) {
    if (!saved) return null;
    const original = saved[key];
    const value = draft[key] ?? "";
    const help = `settings.field.${key}` as MessageKey;
    const disabled = key === "health_check_interval_seconds" ? !draft.health_check_enabled
      : key === "prune_grace_seconds" ? !draft.auto_prune_expired
      : key.startsWith("rate_limit_") && key !== "rate_limit_enabled" ? !draft.rate_limit_enabled : false;
    let control;
    if (typeof original === "boolean") {
      control = <input id={key} type="checkbox" role="switch" className="settings-toggle" checked={Boolean(value)} onChange={e => edit(key, e.target.checked)} />;
    } else if (key === "alias_mode") {
      control = <select id={key} className="field-control" value={String(value)} onChange={e => edit(key, e.target.value)}>
        <option value="random">{t("settings.runtime.aliasRandom")}</option>
        <option value="sequential">{t("settings.runtime.aliasSequential")}</option>
      </select>;
    } else if (Array.isArray(original)) {
      control = <textarea id={key} className="field-control min-h-24" rows={3} value={String(value)} onChange={e => edit(key, e.target.value)} />;
    } else if (key === "prune_grace_seconds" || key === "health_check_interval_seconds") {
      control = <DurationField key={`${key}-${saved.revision}`} id={key} value={String(value)} min={key === "prune_grace_seconds" ? 0 : 1}
        max={key === "prune_grace_seconds" ? 315360000 : 2592000} onChange={v => edit(key, v)} />;
    } else {
      control = <input id={key} className="field-control" type={typeof original === "number" ? "number" : "url"}
        min={0} max={1000000} step={1} required={typeof original === "number"}
        value={String(value)} onChange={e => edit(key, e.target.value)} />;
    }
    return <div className="settings-field" key={key} data-disabled={disabled}>
      <div className="settings-field-copy">
        <label htmlFor={key}>{t(labels[key])}</label>
        <p id={`${key}-help`}>{t(help)}</p>
        {disabled && <span className="settings-field-inactive">{t("settings.form.inactive")}</span>}
      </div>
      <fieldset className="settings-field-control" disabled={disabled} aria-describedby={`${key}-help`}>{control}</fieldset>
    </div>;
  }

  return <SettingsSection title={t(titles[group])} description={t(`settings.${group}.description` as MessageKey)}>
    {loading && <div className="console-skeleton h-32" role="status" aria-label={t("common.loading")} />}
    {error && <p className="console-alert" role="alert">{error}</p>}
    {!loading && !saved && <button className="btn-secondary" onClick={load}>{t("settings.form.retry")}</button>}
    {notice && <p className="console-notice" role="status">{notice}</p>}
    {saved && !loading && <form onSubmit={save}>
      <fieldset disabled={busy} className="min-w-0">
        {runtimeGroups[group].map((key) => <div key={key}>
          {key === "auto_prune_expired" && <p className="settings-field-warning">{t("settings.links.pruneWarning")}</p>}
          {key === "rate_limit_login" && <h3 className="settings-subheading">{t("settings.traffic.authentication")}</h3>}
          {key === "rate_limit_api" && <h3 className="settings-subheading">{t("settings.traffic.service")}</h3>}
          {field(key)}
        </div>)}
        <div className="settings-savebar">
          <span className="mr-auto text-xs text-muted" role="status">{dirty ? t("settings.unsaved") : t("settings.synced")}</span>
          {conflict ? <button type="button" className="btn-secondary" onClick={load}>{t("settings.form.reload")}</button>
            : <button type="button" className="btn-secondary" disabled={!dirty} onClick={() => { setDraft(runtimeDraft(saved, group)); setError(""); setNotice(""); }}>{t("settings.form.discard")}</button>}
          <button className="btn-primary" type="submit" disabled={!dirty || conflict}>{busy ? t("common.saving") : t("settings.form.save")}</button>
        </div>
      </fieldset>
    </form>}
  </SettingsSection>;
}
