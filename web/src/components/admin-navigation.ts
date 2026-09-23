import type { MessageKey } from "@/lib/i18n";
import type { IconName } from "./icon";

export type AdminNavItem = {
  href: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: IconName;
  scope?: string;
  anyScopes?: readonly string[];
};
export type AdminNavGroup = {
  id: string;
  labelKey?: MessageKey;
  descriptionKey?: MessageKey;
  items: readonly AdminNavItem[];
};
export type AdminNavSection = {
  id: "primary" | "settings";
  labelKey?: MessageKey;
  icon?: IconName;
  href?: string;
  groups: readonly AdminNavGroup[];
};

export const adminNavSections: readonly AdminNavSection[] = [
  {
    id: "primary",
    groups: [{
      id: "workspace",
      items: [
        { href: "/home", labelKey: "nav.overview", icon: "grid" },
        { href: "/home/links", labelKey: "nav.links", icon: "link" },
        { href: "/home/stats", labelKey: "nav.stats", icon: "chart" },
        { href: "/home/audit", labelKey: "nav.audit", icon: "list", scope: "audit:read" },
      ],
    }],
  },
  {
    id: "settings",
    labelKey: "shell.settings",
    icon: "settings",
    href: "/home/settings",
    groups: [{
      id: "site",
      items: [
        { href: "/home/settings/links", labelKey: "settings.nav.links", descriptionKey: "settings.nav.linksDescription", icon: "link", scope: "settings:manage" },
        { href: "/home/settings/registration", labelKey: "settings.nav.registration", descriptionKey: "settings.nav.registrationDescription", icon: "lock", anyScopes: ["settings:manage", "captcha:manage", "oidc:manage"] },
        { href: "/home/users", labelKey: "settings.nav.access", descriptionKey: "settings.nav.accessDescription", icon: "user", anyScopes: ["users:manage", "roles:manage"] },
        { href: "/home/settings/traffic", labelKey: "settings.nav.traffic", descriptionKey: "settings.nav.trafficDescription", icon: "shield", scope: "settings:manage" },
        { href: "/home/settings/analytics", labelKey: "settings.nav.analytics", descriptionKey: "settings.nav.analyticsDescription", icon: "pulse", anyScopes: ["settings:manage", "analytics:manage"] },
      ],
    }],
  },
];

export function getVisibleNavigation(scopes: readonly string[]): AdminNavSection[] {
  return adminNavSections.map((section) => ({
    ...section,
    groups: section.groups
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => (!item.scope || scopes.includes(item.scope)) && (!item.anyScopes || item.anyScopes.some((scope) => scopes.includes(scope))))
          .map((item) => item.href === "/home/users" && !scopes.includes("users:manage")
            ? { ...item, href: "/home/settings/roles" }
            : item),
      }))
      .filter((group) => group.items.length > 0),
  }));
}

const routeAliases: Readonly<Record<string, string>> = {
  "/home/settings/runtime": "/home/settings/links",
  "/home/settings/captcha": "/home/settings/registration",
  "/home/settings/oidc": "/home/settings/registration",
  "/home/settings/roles": "/home/users",
};
function navigationPath(pathname: string): string {
  for (const [route, parent] of Object.entries(routeAliases)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return parent + pathname.slice(route.length);
  }
  return pathname;
}

/** Compatibility routes and related editors share their settings category. */
export function isNavItemActive(pathname: string, href: string): boolean {
  const current = navigationPath(pathname);
  const target = navigationPath(href);
  return target === "/home" ? current === target : current === target || current.startsWith(`${target}/`);
}

export type SettingsSearchEntry = {
  href: string;
  labelKey: MessageKey;
  categoryKey: MessageKey;
  contextKey?: MessageKey;
  scope: string;
  keywords?: string;
};
const linkSearch = (field: string, labelKey: MessageKey, page = ""): SettingsSearchEntry => ({
  href: `/home/settings/links${page}#${field}`, labelKey, categoryKey: "settings.nav.links", scope: "settings:manage", keywords: field,
  contextKey: page === "/maintenance" ? "settings.nav.maintenance" : page === "/redirects" ? "settings.nav.redirects" : "settings.nav.creation",
});
const trafficSearch = (field: string, labelKey: MessageKey): SettingsSearchEntry => ({
  href: `/home/settings/traffic#${field}`, labelKey, categoryKey: "settings.nav.traffic", contextKey: "settings.runtime.rateTitle", scope: "settings:manage", keywords: field,
});
const settingsSearchEntries: readonly SettingsSearchEntry[] = [
  linkSearch("alias_mode", "settings.runtime.aliasMode"),
  linkSearch("unique_urls", "settings.runtime.uniqueUrls"),
  linkSearch("max_links_per_user", "settings.runtime.maxLinks"),
  linkSearch("short_domains", "settings.runtime.shortDomains"),
  linkSearch("forward_query", "settings.runtime.forwardQuery", "/redirects"),
  linkSearch("fallback_url", "settings.runtime.fallbackUrl", "/redirects"),
  linkSearch("destination_denylist", "settings.runtime.denylist", "/redirects"),
  linkSearch("health_check_enabled", "settings.runtime.healthCheck", "/maintenance"),
  linkSearch("health_check_interval_seconds", "settings.runtime.healthInterval", "/maintenance"),
  linkSearch("auto_prune_expired", "settings.runtime.autoPrune", "/maintenance"),
  linkSearch("prune_grace_seconds", "settings.runtime.pruneGrace", "/maintenance"),
  { href: "/home/settings/registration#registration_enabled", labelKey: "settings.runtime.registration", categoryKey: "settings.nav.registration", scope: "settings:manage", keywords: "registration_enabled" },
  { href: "/home/settings/registration#totp_enabled", labelKey: "settings.runtime.totpEnabled", categoryKey: "settings.nav.registration", scope: "settings:manage", keywords: "totp_enabled TOTP 2FA two-factor" },
  ...(["title", "siteKey", "secretKey", "expectedHostname", "expectedAction"] as const).map((field): SettingsSearchEntry => ({
    href: "/home/settings/registration#captcha", labelKey: `settings.captcha.${field}`, categoryKey: "settings.nav.registration", scope: "captcha:manage", keywords: "Turnstile CAPTCHA",
  })),
  { href: "/home/settings/oidc", labelKey: "settings.nav.thirdParty", categoryKey: "settings.nav.registration", scope: "oidc:manage", keywords: "OIDC SSO" },
  { href: "/home/settings/oidc", labelKey: "settings.oidc.callback", categoryKey: "settings.nav.registration", scope: "oidc:manage", keywords: "OIDC" },
  { href: "/home/settings/oidc", labelKey: "settings.oidc.autoProvision", categoryKey: "settings.nav.registration", scope: "oidc:manage", keywords: "OIDC" },
  { href: "/home/users", labelKey: "users.title", categoryKey: "settings.nav.access", scope: "users:manage" },
  { href: "/home/settings/roles", labelKey: "settings.roles.title", categoryKey: "settings.nav.access", scope: "roles:manage" },
  trafficSearch("rate_limit_enabled", "settings.runtime.rateEnabled"),
  trafficSearch("rate_limit_login", "settings.runtime.rateLogin"),
  trafficSearch("rate_limit_register", "settings.runtime.rateRegister"),
  trafficSearch("rate_limit_2fa", "settings.runtime.rate2fa"),
  trafficSearch("rate_limit_oidc", "settings.runtime.rateOidc"),
  trafficSearch("rate_limit_api", "settings.runtime.rateApi"),
  trafficSearch("rate_limit_redirect", "settings.runtime.rateRedirect"),
  { href: "/home/settings/analytics#count_bots", labelKey: "settings.runtime.countBots", categoryKey: "settings.nav.analytics", scope: "settings:manage", keywords: "count_bots" },
  ...(["ga4", "gtm", "matomoUrl", "matomoSiteId"] as const).map((field): SettingsSearchEntry => ({
    href: "/home/settings/analytics#integrations", labelKey: `settings.analytics.${field}`, categoryKey: "settings.nav.analytics", scope: "analytics:manage",
  })),
];

/** Search never discloses editors that the current account cannot use. */
export function getVisibleSettingsSearchEntries(scopes: readonly string[]): SettingsSearchEntry[] {
  return settingsSearchEntries.filter((entry) => scopes.includes(entry.scope));
}
