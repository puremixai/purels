"use client";

import { useCallback, useEffect, useState } from "react";
import { api, AnalyticsInput, AnalyticsSettings, ApiError } from "@/lib/api-client";
import { validateAnalyticsInput } from "@/lib/analytics-config";

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
function describeError(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.status === 403 ? "没有权限管理埋点。" : e.message;
  return fallback;
}

export default function AnalyticsSettingsPage() {
  const [saved, setSaved] = useState<AnalyticsInput>(emptyDraft);
  const [draft, setDraft] = useState<AnalyticsInput>(emptyDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = toDraft(await api.analytics.get());
      setSaved(next);
      setDraft(next);
      setError("");
    } catch (e) {
      setError(describeError(e, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function edit(change: Partial<AnalyticsInput>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...change }));
  }

  const dirty = (Object.keys(draft) as Array<keyof AnalyticsInput>).some((key) => draft[key] !== saved[key]);

  async function save() {
    // Checked here so the operator gets a sentence naming the field, rather than
    // the service's English message arriving as a 400.
    const invalid = validateAnalyticsInput(draft);
    if (invalid) {
      setNotice("");
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = toDraft(await api.analytics.update(draft));
      setSaved(next);
      setDraft(next);
      setNotice("已保存");
    } catch (e) {
      setError(describeError(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">工作台 / 埋点统计</p>
        <h1 className="mt-1 text-2xl font-bold">埋点统计</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{notice}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">正在加载...</p>}

      {!loading && (
        <section className="panel space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">GA4 衡量 ID</span>
              <input
                className="field-control"
                placeholder="G-XXXXXXXXXX"
                value={draft.ga4_measurement_id}
                onChange={(e) => edit({ ga4_measurement_id: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">GTM 容器 ID</span>
              <input
                className="field-control"
                placeholder="GTM-XXXXXXX"
                value={draft.gtm_container_id}
                onChange={(e) => edit({ gtm_container_id: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Matomo 地址</span>
              <input
                className="field-control"
                placeholder="https://matomo.example.com"
                value={draft.matomo_url}
                onChange={(e) => edit({ matomo_url: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Matomo 站点 ID</span>
              <input
                className="field-control"
                placeholder="1"
                value={draft.matomo_site_id}
                onChange={(e) => edit({ matomo_site_id: e.target.value })}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? "正在保存..." : "保存"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
