"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AnalyticsInput, AnalyticsSettings } from "@/lib/api-client";
import { useSettingsTranslator } from "./use-settings-translator";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText, type MessageKey, type T } from "@/lib/i18n";
import { validateAnalyticsInput } from "@/lib/analytics-config";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsSection } from "@/components/settings/settings-page";
import { useSettingsDirty } from "./settings-draft-guard";

const emptyDraft: AnalyticsInput = {
  ga4_measurement_id: "",
  gtm_container_id: "",
  matomo_url: "",
  matomo_site_id: "",
};

function toDraft(settings: AnalyticsSettings): AnalyticsInput {
  return {
    ga4_measurement_id: settings.ga4_measurement_id,
    gtm_container_id: settings.gtm_container_id,
    matomo_url: settings.matomo_url,
    matomo_site_id: settings.matomo_site_id,
  };
}

/**
 * An account without analytics:manage gets a 403 here. It is rendered as a
 * permission boundary rather than as the API's own wording, so a page that is
 * merely out of reach does not look like a page that broke.
 */
function describeError(t: T, e: unknown, fallback: MessageKey) {
  return errorText(t, e, fallback, { 403: "settings.analytics.noPermission" });
}

export function TrackingForm() {
  const t = useT();
  const translate = useSettingsTranslator();
  const { toast } = useToast();
  const [saved, setSaved] = useState<AnalyticsInput>(emptyDraft);
  const [draft, setDraft] = useState<AnalyticsInput>(emptyDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    try {
      const next = toDraft(await api.analytics.get());
      setSaved(next);
      setDraft(next);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(describeError(translate, e, "error.load"));
    } finally {
      setLoading(false);
    }
  }, [translate]);

  useEffect(() => {
    load();
  }, [load]);

  function edit(change: Partial<AnalyticsInput>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...change }));
  }

  const dirty = (Object.keys(draft) as Array<keyof AnalyticsInput>).some((key) => draft[key] !== saved[key]);
  useSettingsDirty(dirty);
  const configuredCount = [draft.ga4_measurement_id, draft.gtm_container_id, draft.matomo_url && draft.matomo_site_id].filter(Boolean).length;

  async function save() {
    // Checked here so the operator gets a sentence naming the field, rather than
    // the service's English message arriving as a 400.
    const invalid = validateAnalyticsInput(draft);
    if (invalid) {
      setNotice("");
      setError(t(invalid));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = toDraft(await api.analytics.update(draft));
      setSaved(next);
      setDraft(next);
      setNotice(t("settings.saved"));
      toast({ kind: "success", title: t("settings.saved") });
    } catch (e) {
      setError(describeError(t, e, "error.save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>

      {error && <p className="console-alert" role="alert">{error}</p>}
      {notice && <p className="console-notice" role="status">{notice}</p>}
      {loading && <span className="console-skeleton w-32" role="status" aria-label={t("common.loading")} />}

      {!loading && !loaded && <button className="btn-secondary" onClick={load}>{t("settings.form.retry")}</button>}
      {!loading && loaded && (
        <SettingsSection
          id="integrations"
          title={t("settings.analytics.providersTitle")}
          description={t("settings.analytics.providersDescription")}
          status={<RareStatus tone={configuredCount ? "success" : "neutral"}>{t("settings.analytics.configuredCount", { count: configuredCount })}</RareStatus>}
        >
          <fieldset disabled={busy} className="min-w-0">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="settings-provider-card">
              <div className="settings-provider-card-header">
                <div>
                  <h3 className="settings-provider-card-title">{t("settings.analytics.ga4")}</h3>
                  <p className="settings-provider-card-description">{t("settings.analytics.ga4Description")}</p>
                </div>
                <RareStatus tone={draft.ga4_measurement_id ? "success" : "neutral"}>{draft.ga4_measurement_id ? t("settings.configured") : t("settings.notConfigured")}</RareStatus>
              </div>
              <input className="field-control" placeholder="G-XXXXXXXXXX" aria-label={t("settings.analytics.ga4")} value={draft.ga4_measurement_id} onChange={(e) => edit({ ga4_measurement_id: e.target.value })} />
            </div>
            <div className="settings-provider-card">
              <div className="settings-provider-card-header">
                <div>
                  <h3 className="settings-provider-card-title">{t("settings.analytics.gtm")}</h3>
                  <p className="settings-provider-card-description">{t("settings.analytics.gtmDescription")}</p>
                </div>
                <RareStatus tone={draft.gtm_container_id ? "success" : "neutral"}>{draft.gtm_container_id ? t("settings.configured") : t("settings.notConfigured")}</RareStatus>
              </div>
              <input className="field-control" placeholder="GTM-XXXXXXX" aria-label={t("settings.analytics.gtm")} value={draft.gtm_container_id} onChange={(e) => edit({ gtm_container_id: e.target.value })} />
            </div>
            <div className="settings-provider-card">
              <div className="settings-provider-card-header">
                <div>
                  <h3 className="settings-provider-card-title">Matomo</h3>
                  <p className="settings-provider-card-description">{t("settings.analytics.matomoDescription")}</p>
                </div>
                <RareStatus tone={draft.matomo_url && draft.matomo_site_id ? "success" : "neutral"}>{draft.matomo_url && draft.matomo_site_id ? t("settings.configured") : t("settings.notConfigured")}</RareStatus>
              </div>
              <div className="grid gap-3">
                <input className="field-control" placeholder="https://matomo.example.com" aria-label={t("settings.analytics.matomoUrl")} value={draft.matomo_url} onChange={(e) => edit({ matomo_url: e.target.value })} />
                <input className="field-control" placeholder="1" aria-label={t("settings.analytics.matomoSiteId")} value={draft.matomo_site_id} onChange={(e) => edit({ matomo_site_id: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="settings-savebar">
            {dirty && <span className="mr-auto text-xs text-[var(--muted)]">{t("settings.unsaved")}</span>}
            <button className="btn-secondary" disabled={!dirty || busy} onClick={() => { setDraft(saved); setError(""); setNotice(""); }}>{t("settings.form.discard")}</button>
            <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
          </fieldset>
        </SettingsSection>
      )}
    </>
  );
}
