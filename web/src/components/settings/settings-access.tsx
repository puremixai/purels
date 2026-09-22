"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";
import { useSettingsTranslator } from "./use-settings-translator";
import { useT } from "@/components/i18n-provider";

export function SettingsAccess({ children }: { children: (scopes: readonly string[]) => ReactNode }) {
  const t = useT();
  const translate = useSettingsTranslator();
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setScopes((await api.auth.me()).scopes ?? []); }
    catch (e) { setError(errorText(translate, e, "error.load")); }
  }, [translate]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="console-alert" role="alert">{error} <button className="btn-secondary" onClick={load}>{t("settings.form.retry")}</button></div>;
  if (!scopes) return <div className="console-panel console-skeleton h-32" role="status" aria-label={t("common.loading")} />;
  return children(scopes);
}

export function SettingsForbidden() {
  const t = useT();
  return <p className="console-alert" role="alert">{t("settings.form.forbidden")}</p>;
}
