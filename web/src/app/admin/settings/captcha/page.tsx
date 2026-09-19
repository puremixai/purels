"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CaptchaInput, type CaptchaSettings } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { errorText, type MessageKey, type T } from "@/lib/i18n";

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

export default function CaptchaSettingsPage() {
  const t = useT();
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = toDraft(await api.captcha.get());
      setSaved(next);
      setDraft(next);
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

  function edit(change: Partial<Draft>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...change }));
  }

  const dirty = (Object.keys(draft) as Array<keyof Draft>).some((key) => draft[key] !== saved[key]);

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
    } catch (e) {
      setError(describeError(t, e, "error.save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("settings.captcha.title")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("settings.captcha.title")}</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{notice}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>}

      {!loading && (
        <section className="panel space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Cloudflare Turnstile</h2>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.enabled} onChange={() => edit({ enabled: !draft.enabled })} />
              {t("settings.captcha.enable")}
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">{t("settings.captcha.siteKey")}</span>
              <input className="field-control" value={draft.site_key} onChange={(e) => edit({ site_key: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">{t("settings.captcha.secretKey")}{draft.has_secret ? t("settings.leaveBlank") : ""}</span>
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
              <span className="text-[var(--muted)]">{t("settings.captcha.expectedHostname")}</span>
              <input className="field-control" placeholder="example.com" value={draft.expected_hostname} onChange={(e) => edit({ expected_hostname: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">{t("settings.captcha.expectedAction")}</span>
              <input className="field-control" placeholder="register" value={draft.expected_action} onChange={(e) => edit({ expected_action: e.target.value })} />
            </label>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
