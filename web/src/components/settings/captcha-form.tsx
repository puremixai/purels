"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CaptchaInput, type CaptchaSettings } from "@/lib/api-client";
import { useSettingsTranslator } from "./use-settings-translator";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText, type MessageKey, type T } from "@/lib/i18n";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsSection } from "@/components/settings/settings-page";
import { useSettingsDirty } from "./settings-draft-guard";

type Draft = {
  enabled: boolean;
  site_key: string;
  secret: string;
  has_secret: boolean;
  expected_hostname: string;
  expected_action: string;
};

const emptyDraft: Draft = {
  enabled: false,
  site_key: "",
  secret: "",
  has_secret: false,
  expected_hostname: "",
  expected_action: "",
};

function toDraft(settings: CaptchaSettings): Draft {
  return {
    enabled: settings.enabled,
    site_key: settings.site_key,
    secret: "",
    has_secret: settings.has_secret,
    expected_hostname: settings.expected_hostname,
    expected_action: settings.expected_action,
  };
}

/**
 * An account without captcha:manage gets a 403 here. It is rendered as a
 * permission boundary rather than as the API's own wording, so a page that is
 * merely out of reach does not look like a page that broke.
 */
function describeError(t: T, e: unknown, fallback: MessageKey) {
  return errorText(t, e, fallback, { 403: "settings.captcha.noPermission" });
}

export function CaptchaForm() {
  const t = useT();
  const translate = useSettingsTranslator();
  const { toast } = useToast();
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    try {
      const next = toDraft(await api.captcha.get());
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

  function edit(change: Partial<Draft>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...change }));
  }

  const dirty = (Object.keys(draft) as Array<keyof Draft>).some((key) => draft[key] !== saved[key]);
  useSettingsDirty(dirty);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    const input: CaptchaInput = {
      enabled: draft.enabled,
      site_key: draft.site_key,
      expected_hostname: draft.expected_hostname,
      expected_action: draft.expected_action,
    };
    if (draft.secret) input.secret = draft.secret;
    try {
      const next = toDraft(await api.captcha.update(input));
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
          id="captcha"
          title={t("settings.captcha.provider")}
          description={t("settings.captcha.providerDescription")}
          status={<RareStatus tone={draft.enabled ? "success" : "neutral"}>{draft.enabled ? t("settings.security.enabled") : t("settings.security.notEnabled")}</RareStatus>}
          actions={(
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" disabled={busy} checked={draft.enabled} onChange={() => edit({ enabled: !draft.enabled })} />
              {t("settings.captcha.enable")}
            </label>
          )}
        >
          <fieldset disabled={busy} className="min-w-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--ink)]">{t("settings.captcha.siteKey")}</span>
              <input className="field-control" value={draft.site_key} onChange={(e) => edit({ site_key: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--ink)]">{t("settings.captcha.secretKey")}{draft.has_secret ? t("settings.leaveBlank") : ""}</span>
              <input
                className="field-control"
                type="password"
                autoComplete="new-password"
                placeholder={draft.has_secret ? t("settings.secretSet") : t("settings.secretUnset")}
                value={draft.secret}
                onChange={(e) => edit({ secret: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--ink)]">{t("settings.captcha.expectedHostname")}</span>
              <input className="field-control" placeholder="example.com" value={draft.expected_hostname} onChange={(e) => edit({ expected_hostname: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--ink)]">{t("settings.captcha.expectedAction")}</span>
              <input className="field-control" placeholder="register" value={draft.expected_action} onChange={(e) => edit({ expected_action: e.target.value })} />
            </label>
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
