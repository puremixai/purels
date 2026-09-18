"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type CaptchaInput, type CaptchaSettings } from "@/lib/api-client";

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

function describeError(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.status === 403 ? "没有权限管理注册保护。" : error.message;
  return fallback;
}

export default function CaptchaSettingsPage() {
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
      setError(describeError(e, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

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
        <p className="text-sm text-[var(--muted)]">工作台 / 注册保护</p>
        <h1 className="mt-1 text-2xl font-bold">注册保护</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{notice}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">正在加载...</p>}

      {!loading && (
        <section className="panel space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Cloudflare Turnstile</h2>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.enabled} onChange={() => edit({ enabled: !draft.enabled })} />
              启用
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">站点密钥</span>
              <input className="field-control" value={draft.site_key} onChange={(e) => edit({ site_key: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">密钥{draft.has_secret ? "（留空保持不变）" : ""}</span>
              <input
                className="field-control"
                type="password"
                autoComplete="new-password"
                placeholder={draft.has_secret ? "已设置" : "未设置"}
                value={draft.secret}
                onChange={(e) => edit({ secret: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">预期主机名</span>
              <input className="field-control" placeholder="example.com" value={draft.expected_hostname} onChange={(e) => edit({ expected_hostname: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">预期动作</span>
              <input className="field-control" placeholder="register" value={draft.expected_action} onChange={(e) => edit({ expected_action: e.target.value })} />
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
