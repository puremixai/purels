"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AdminUser } from "@/lib/api-client";
import { hasMessage, type MessageKey } from "@/lib/i18n";
import { Icon, type IconName } from "./icon";
import { useT } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { BounceSidebar } from "./ui/rare/bounce-sidebar";

/**
 * Each entry names the scope that unlocks it, or none when every signed-in
 * account may use it. The API enforces the same scopes, so this only decides
 * what is worth showing.
 *
 * The labels are keys rather than text: this list is built once at module load,
 * before there is a language to resolve them in.
 */
const navItems: Array<{ href: string; labelKey: MessageKey; icon: IconName; scope?: string }> = [
  { href: "/home", labelKey: "nav.overview", icon: "grid" },
  { href: "/home/links", labelKey: "nav.links", icon: "link" },
  { href: "/home/stats", labelKey: "nav.stats", icon: "chart" },
  { href: "/home/audit", labelKey: "nav.audit", icon: "list", scope: "audit:read" },
  { href: "/home/users", labelKey: "nav.users", icon: "user", scope: "users:manage" },
  { href: "/home/settings/roles", labelKey: "nav.roles", icon: "key", scope: "roles:manage" },
  { href: "/home/settings/oidc", labelKey: "nav.oidc", icon: "lock", scope: "oidc:manage" },
  { href: "/home/settings/analytics", labelKey: "nav.analytics", icon: "pulse", scope: "analytics:manage" },
  { href: "/home/settings/security", labelKey: "nav.security", icon: "shield" },
  { href: "/home/settings/captcha", labelKey: "nav.captcha", icon: "shield", scope: "captcha:manage" },
  { href: "/home/settings/runtime", labelKey: "nav.runtimeSettings", icon: "refresh", scope: "settings:manage" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const [mobileNav, setMobileNav] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    // The scopes decide which sections this account can use. Until they are
    // known the gated entries stay hidden rather than showing and then
    // disappearing.
    api.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  const scopes = user?.scopes || [];
  const items = navItems.filter((item) => !item.scope || scopes.includes(item.scope));
  const activeIndex = Math.max(0, items.findIndex((item) => pathname === item.href || (item.href !== "/home" && pathname.startsWith(item.href))) + 1);
  const sidebarItems = [
    { label: t("shell.workspace"), heading: true as const },
    ...items.map((item) => ({ label: t(item.labelKey), href: item.href, icon: <Icon name={item.icon} size={16} /> })),
  ];
  const username = user?.username || "";
  const avatar = (username || "P").slice(0, 1).toUpperCase();
  // Roles are rows in the database, so an unrecognised name shows as the raw
  // value rather than disappearing.
  const roleKey = user?.role ? `role.${user.role}` : "";
  const roleLabel = hasMessage(roleKey) ? t(roleKey) : (user?.role ?? "");

  async function logout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#100b08]">{t("shell.workspace")}</a>
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-[var(--line)] bg-surface px-4 py-5 transition-transform md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-9 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--brand)] text-sm font-bold text-[#100b08] shadow-[0_8px_24px_color-mix(in_srgb,var(--brand)_28%,transparent)]">P</div>
          <div>
            <div className="font-semibold tracking-tight text-[var(--ink)]">Purels</div>
            <div className="text-2xs text-[var(--muted)]">{t("shell.console")}</div>
          </div>
          <button className="ml-auto rounded p-1 text-faint md:hidden" onClick={() => setMobileNav(false)} aria-label={t("shell.closeMenu")}><Icon name="close" size={17} /></button>
        </div>
        <BounceSidebar items={sidebarItems} value={activeIndex} dotColor="var(--brand)" ariaLabel={t("shell.console")} className="px-1" />
        <div className="mt-auto border-t border-[var(--line)] pt-4">
          <ThemeToggle />
          <LocaleSwitcher className="field-control mb-2 py-2 text-sm text-ink-soft" />
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-danger-tint hover:text-danger" disabled={loggingOut} onClick={logout}><Icon name="logout" size={17} />{loggingOut ? t("shell.loggingOut") : t("shell.logout")}</button>
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-black/70 md:hidden" aria-label={t("shell.closeMenu")} onClick={() => setMobileNav(false)} />}
      <div className="md:pl-[250px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-surface/90 px-5 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 text-muted hover:bg-canvas md:hidden" onClick={() => setMobileNav(true)} aria-label={t("shell.openMenu")}><Icon name="menu" size={20} /></button>
          <div className="hidden text-sm text-muted md:block">{username ? t("shell.welcomeNamed", { username }) : t("shell.welcome")}</div>
          <div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><div className="text-xs font-semibold">{username || "—"}</div><div className="text-2xs text-faint">{roleLabel}</div></div><div className="grid h-9 w-9 place-items-center rounded-full bg-brand-tint text-xs font-bold text-[var(--brand)]">{avatar}</div></div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1250px] px-5 py-7 md:px-8 md:py-9">{children}</main>
      </div>
    </div>
  );
}
