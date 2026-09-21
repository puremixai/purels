"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AdminUser } from "@/lib/api-client";
import { hasMessage } from "@/lib/i18n";
import { getVisibleNavigation } from "./admin-navigation";
import { Icon } from "./icon";
import { useT } from "./i18n-provider";
import { AccountMenu } from "./rare/account-menu";
import { BounceSidebar } from "./ui/rare/bounce-sidebar";

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
  const [primarySection, settingsSection] = getVisibleNavigation(scopes);
  const sidebarItems = [
    { label: t("shell.workspace"), heading: true as const },
    ...primarySection.groups.flatMap((group) => group.items).map((item) => ({ label: t(item.labelKey), href: item.href, icon: <Icon name={item.icon} size={16} /> })),
    {
      label: t(settingsSection.labelKey ?? "shell.settings"),
      group: true as const,
      icon: <Icon name={settingsSection.icon ?? "settings"} size={16} />,
      sections: settingsSection.groups.map((group) => ({
        label: group.labelKey ? t(group.labelKey) : "",
        items: group.items.map((item) => ({ label: t(item.labelKey), href: item.href, icon: <Icon name={item.icon} size={15} /> })),
      })),
    },
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
    <div className="min-h-[100dvh] bg-canvas">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#100b08]">{t("shell.workspace")}</a>
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-[var(--line)] bg-surface px-3 py-4 transition-transform md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--brand)] text-sm font-bold text-[#100b08] shadow-[0_8px_24px_color-mix(in_srgb,var(--brand)_28%,transparent)]">P</div>
          <div>
            <div className="font-semibold tracking-tight text-[var(--ink)]">Purels</div>
            <div className="text-2xs text-[var(--muted)]">{t("shell.console")}</div>
          </div>
          <button className="ml-auto rounded p-1 text-faint md:hidden" onClick={() => setMobileNav(false)} aria-label={t("shell.closeMenu")}><Icon name="close" size={17} /></button>
        </div>
        <BounceSidebar items={sidebarItems} activeHref={pathname} dotColor="var(--brand)" ariaLabel={t("shell.console")} className="px-1" />
        <div className="mt-auto border-t border-[var(--line)] pt-3">
          <AccountMenu
            username={username}
            secondaryLabel={roleLabel || t("shell.account")}
            avatar={avatar}
            loggingOut={loggingOut}
            onLogout={logout}
          />
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-black/70 md:hidden" aria-label={t("shell.closeMenu")} onClick={() => setMobileNav(false)} />}
      <div className="md:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--line)] bg-surface/90 px-4 backdrop-blur md:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-canvas md:hidden" onClick={() => setMobileNav(true)} aria-label={t("shell.openMenu")}><Icon name="menu" size={20} /></button>
          <div className="hidden text-sm text-muted md:block">{username ? t("shell.welcomeNamed", { username }) : t("shell.welcome")}</div>
          <div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><div className="text-xs font-semibold">{username || "Purels"}</div><div className="text-2xs text-faint">{roleLabel}</div></div><div className="grid h-9 w-9 place-items-center rounded-full bg-brand-tint text-xs font-bold text-[var(--brand)]">{avatar}</div></div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
