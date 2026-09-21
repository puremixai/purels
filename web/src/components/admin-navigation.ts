import type { MessageKey } from "@/lib/i18n";
import type { IconName } from "./icon";

export type AdminNavItem = {
  href: string;
  labelKey: MessageKey;
  icon: IconName;
  scope?: string;
};

export type AdminNavGroup = {
  id: string;
  labelKey?: MessageKey;
  items: readonly AdminNavItem[];
};

export type AdminNavSection = {
  id: "primary" | "settings";
  labelKey?: MessageKey;
  icon?: IconName;
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
    groups: [
      {
        id: "access",
        labelKey: "nav.group.access",
        items: [
          { href: "/home/users", labelKey: "nav.users", icon: "user", scope: "users:manage" },
          { href: "/home/settings/roles", labelKey: "nav.roles", icon: "key", scope: "roles:manage" },
          { href: "/home/settings/oidc", labelKey: "nav.oidc", icon: "lock", scope: "oidc:manage" },
        ],
      },
      {
        id: "security",
        labelKey: "nav.group.security",
        items: [
          { href: "/home/settings/security", labelKey: "nav.security", icon: "shield" },
          { href: "/home/settings/captcha", labelKey: "nav.captcha", icon: "shield", scope: "captcha:manage" },
        ],
      },
      {
        id: "system",
        labelKey: "nav.group.system",
        items: [
          { href: "/home/settings/analytics", labelKey: "nav.analytics", icon: "pulse", scope: "analytics:manage" },
          { href: "/home/settings/runtime", labelKey: "nav.runtimeSettings", icon: "refresh", scope: "settings:manage" },
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
