"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type AnalyticsSettings, type CaptchaSettings, type OIDCProvider, type RuntimeSettings } from "@/lib/api-client";
import { errorText, tFor, type MessageKey } from "@/lib/i18n";
import { getVisibleNavigation, getVisibleSettingsSearchEntries } from "@/components/admin-navigation";
import { Icon } from "@/components/icon";
import { useT } from "@/components/i18n-provider";
import { RareButton } from "@/components/rare/rare-button";
import { SettingsPage } from "@/components/settings/settings-page";

type Summary = {
  loading: boolean;
  runtime?: RuntimeSettings | null;
  captcha?: CaptchaSettings | null;
  oidc?: { providers: OIDCProvider[]; redirect_base: string } | null;
  analytics?: AnalyticsSettings | null;
  failed: string[];
};
function fulfilled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

export default function SettingsHomePage() {
  const t = useT();
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [summary, setSummary] = useState<Summary>({ loading: true, failed: [] });
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setScopes(null);
    setLoadError(null);
    setSummary({ loading: true, failed: [] });
    async function load() {
      try {
        const user = await api.auth.me();
        if (!active) return;
        const allowed = user.scopes || [];
        setScopes(allowed);
        const results = await Promise.allSettled([
          allowed.includes("settings:manage") ? api.runtimeSettings.get() : Promise.resolve(null),
          allowed.includes("captcha:manage") ? api.captcha.get() : Promise.resolve(null),
          allowed.includes("oidc:manage") ? api.oidc.list() : Promise.resolve(null),
          allowed.includes("analytics:manage") ? api.analytics.get() : Promise.resolve(null),
        ]);
        if (!active) return;
        const [runtime, captcha, oidc, analytics] = results;
        setSummary({
          loading: false,
          runtime: fulfilled(runtime), captcha: fulfilled(captcha), oidc: fulfilled(oidc), analytics: fulfilled(analytics),
          failed: results.flatMap((result, index) => result.status === "rejected" ? [["runtime", "captcha", "oidc", "analytics"][index]] : []),
        });
      } catch (error) {
        if (!active) return;
        setLoadError(error);
        setScopes([]);
        setSummary({ loading: false, failed: [] });
      }
    }
    void load();
    return () => { active = false; };
  }, [refresh]);

  const allowed = scopes || [];
  const categories = getVisibleNavigation(allowed).find((section) => section.id === "settings")?.groups.flatMap((group) => group.items) || [];
  const search = query.trim().toLocaleLowerCase();
  const results = getVisibleSettingsSearchEntries(allowed).filter((entry) => {
    const text = [t(entry.labelKey), t(entry.categoryKey), entry.contextKey ? t(entry.contextKey) : "", tFor("en")(entry.labelKey), tFor("zh-CN")(entry.labelKey), entry.keywords || ""].join(" ").toLocaleLowerCase();
    return search.split(/\s+/).every((word) => text.includes(word));
  });

  function categoryStatus(category: MessageKey): string[] {
    if (category === "settings.nav.access") return [];
    if (summary.loading) return [t("common.loading")];
    const messages: string[] = [];
    const relevant: string[] = [];
    const runtime = summary.runtime;
    if (category === "settings.nav.links") {
      relevant.push("runtime");
      if (runtime) messages.push(t(runtime.health_check_enabled ? "settings.nav.healthEnabled" : "settings.nav.healthDisabled"), t(runtime.auto_prune_expired ? "settings.nav.cleanupEnabled" : "settings.nav.cleanupDisabled"));
    }
    if (category === "settings.nav.registration") {
      relevant.push("runtime", "captcha", "oidc");
      if (runtime) messages.push(t(runtime.registration_enabled ? "settings.nav.registrationOpen" : "settings.nav.registrationClosed"));
      if (summary.captcha) messages.push(t(summary.captcha.enabled ? "settings.nav.captchaEnabled" : "settings.nav.captchaDisabled"));
      if (summary.oidc) messages.push(t("settings.nav.oidcEnabled", { count: summary.oidc.providers.filter((provider) => provider.enabled).length }));
    }
    if (category === "settings.nav.traffic") {
      relevant.push("runtime");
      if (runtime) messages.push(t(runtime.rate_limit_enabled ? "settings.nav.rateEnabled" : "settings.nav.rateDisabled"));
    }
    if (category === "settings.nav.analytics") {
      relevant.push("runtime", "analytics");
      if (runtime) messages.push(t(runtime.count_bots ? "settings.nav.botsIncluded" : "settings.nav.botsExcluded"));
      if (summary.analytics) {
        const { ga4_measurement_id, gtm_container_id, matomo_url, matomo_site_id } = summary.analytics;
        messages.push(t("settings.nav.integrationsConfigured", { count: [ga4_measurement_id, gtm_container_id, matomo_url && matomo_site_id].filter(Boolean).length }));
      }
    }
    if (summary.failed.some((source) => relevant.includes(source))) messages.push(t("settings.nav.statusUnavailable"));
    return messages;
  }

  return (
    <SettingsPage root title={t("settings.home.title")} description={t("settings.nav.description")}>
      {loadError ? (
        <div className="console-alert" role="alert">
          <p>{errorText(t, loadError, "error.load")}</p>
          <RareButton type="button" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>{t("common.retry")}</RareButton>
        </div>
      ) : scopes === null ? (
        <div className="settings-home-categories" role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 5 }, (_, index) => <span className="console-panel console-skeleton h-28" key={index} />)}
        </div>
      ) : categories.length ? (
        <>
          <div className="settings-search">
            <label className="field-label" htmlFor="settings-search">{t("settings.search.label")}</label>
            <input className="field-control" id="settings-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.search.placeholder")} aria-describedby="settings-search-hint" />
            <p className="text-xs text-muted" id="settings-search-hint">{t("settings.search.hint")}</p>
          </div>
          {search ? (
            <section className="console-panel settings-search-results" aria-label={t("settings.search.results")}>
              <p className="text-sm text-muted" role="status">{t("settings.search.resultCount", { count: results.length })}</p>
              {results.length ? <ul className="settings-home-items">{results.map((entry) => (
                <li key={`${entry.href}-${entry.labelKey}`}>
                  <Link className="settings-home-item" href={entry.href}>
                    <span className="settings-home-item-copy">
                      <span className="settings-home-item-title">{t(entry.labelKey)}</span>
                      <span className="settings-home-item-description">{t(entry.categoryKey)}</span>
                    </span>
                    <Icon name="arrow" size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}</ul> : <p className="console-empty">{t("settings.search.empty")}</p>}
            </section>
          ) : (
            <div className="settings-home-categories">
              {categories.map((item) => (
                <Link className="settings-category" href={item.href} key={item.href}>
                  <span className="settings-home-group-icon" aria-hidden="true"><Icon name={item.icon} size={18} /></span>
                  <span className="settings-category-copy">
                    <span className="settings-home-group-title">{t(item.labelKey)}</span>
                    {item.descriptionKey && <span className="settings-home-group-description">{t(item.descriptionKey)}</span>}
                    <span className="settings-category-status">{categoryStatus(item.labelKey).map((status) => <span key={status}>{status}</span>)}</span>
                  </span>
                  <Icon name="arrow" size={16} className="shrink-0 text-muted" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
          {summary.failed.length > 0 && <div className="console-actions"><RareButton type="button" variant="quiet" onClick={() => setRefresh((value) => value + 1)}>{t("settings.nav.retryStatus")}</RareButton></div>}
        </>
      ) : <p className="console-empty">{t("settings.home.noAccess")}</p>}
    </SettingsPage>
  );
}
