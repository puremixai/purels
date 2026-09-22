import type { MessageKey } from "@/lib/i18n";
import type { IconName } from "./icon";

export type AdminNavItem = {
  href: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: IconName;
  scope?: string;
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
  /**
   * Where the section heading itself goes. A collapsed group whose heading is
   * only a disclosure triangle leaves the reader clicking twice to reach the
   * page they named, so the heading is the page and the triangle is the triangle.
   */
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
    groups: [
      {
        id: "access",
        labelKey: "nav.group.access",
        descriptionKey: "settings.home.accessDescription",
        items: [
          { href: "/home/users", labelKey: "nav.users", descriptionKey: "settings.home.usersDescription", icon: "user", scope: "users:manage" },
          { href: "/home/settings/roles", labelKey: "nav.roles", descriptionKey: "settings.home.rolesDescription", icon: "key", scope: "roles:manage" },
          { href: "/home/settings/oidc", labelKey: "nav.oidc", descriptionKey: "settings.home.oidcDescription", icon: "lock", scope: "oidc:manage" },
        ],
      },
      {
        id: "security",
        labelKey: "nav.group.security",
        descriptionKey: "settings.home.securityDescription",
        items: [
          { href: "/home/settings/security", labelKey: "nav.security", descriptionKey: "settings.home.securityPageDescription", icon: "shield" },
          { href: "/home/settings/captcha", labelKey: "nav.captcha", descriptionKey: "settings.home.captchaDescription", icon: "shield", scope: "captcha:manage" },
        ],
      },
      {
        id: "links",
        labelKey: "nav.group.links",
        descriptionKey: "settings.home.linksDescription",
        items: [
          { href: "/home/settings/runtime", labelKey: "nav.runtimeSettings", descriptionKey: "settings.home.runtimeDescription", icon: "link", scope: "settings:manage" },
        ],
      },
      {
        id: "analytics",
        labelKey: "nav.group.analytics",
        descriptionKey: "settings.home.analyticsDescription",
        items: [
          { href: "/home/settings/analytics", labelKey: "nav.analytics", descriptionKey: "settings.home.analyticsPageDescription", icon: "pulse", scope: "analytics:manage" },
        ],
      },
    ],
  },
];

export function getVisibleNavigation(scopes: readonly string[]): AdminNavSection[] {
  return adminNavSections.map((section) => ({
    ...section,
    groups: section.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.scope || scopes.includes(item.scope)),
      }))
      .filter((group) => group.items.length > 0),
  }));
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/home"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
