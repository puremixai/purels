"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n";

type SettingsTab = { href: string; labelKey: MessageKey; anyScopes: readonly string[] };
const tabs = {
  links: [
    { href: "/home/settings/links", labelKey: "settings.nav.creation", anyScopes: ["settings:manage"] },
    { href: "/home/settings/links/redirects", labelKey: "settings.nav.redirects", anyScopes: ["settings:manage"] },
    { href: "/home/settings/links/maintenance", labelKey: "settings.nav.maintenance", anyScopes: ["settings:manage"] },
  ],
  registration: [
    { href: "/home/settings/registration", labelKey: "settings.nav.publicRegistration", anyScopes: ["settings:manage", "captcha:manage"] },
    { href: "/home/settings/oidc", labelKey: "settings.nav.thirdParty", anyScopes: ["oidc:manage"] },
  ],
  access: [
    { href: "/home/users", labelKey: "nav.users", anyScopes: ["users:manage"] },
    { href: "/home/settings/roles", labelKey: "settings.roles.title", anyScopes: ["roles:manage"] },
  ],
} satisfies Record<string, readonly SettingsTab[]>;

type SettingsTabsProps = { group: keyof typeof tabs; scopes: readonly string[] };

export function SettingsTabs({ group, scopes }: SettingsTabsProps) {
  const t = useT();
  const pathname = usePathname();
  const visible = tabs[group].filter((tab) => tab.anyScopes.some((scope) => scopes.includes(scope)));
  if (!visible.length) return null;

  return (
    <nav className="settings-tabs" aria-label={t(`settings.nav.${group}`)}>
      {visible.map((tab) => {
        const active = pathname === tab.href || (tab.href !== "/home/settings/links" && pathname.startsWith(`${tab.href}/`));
        return <Link className="settings-tab" key={tab.href} href={tab.href} data-active={active} aria-current={active ? "page" : undefined}>{t(tab.labelKey)}</Link>;
      })}
    </nav>
  );
}
