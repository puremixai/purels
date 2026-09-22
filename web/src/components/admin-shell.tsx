"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AdminUser } from "@/lib/api-client";
import { hasMessage } from "@/lib/i18n";
import { getVisibleNavigation, isNavItemActive } from "./admin-navigation";
import { Icon } from "./icon";
import { useT } from "./i18n-provider";
import { AccountMenu } from "./rare/account-menu";
import { BounceSidebar } from "./ui/rare/bounce-sidebar";

/**
 * The drawer is only a drawer below the `md` breakpoint; on desktop the same
 * element is the permanent sidebar, so `inert` must not be applied there even
 * though the mobile open-state is closed.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const isDesktop = useIsDesktop();
  const [mobileNav, setMobileNav] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The scopes decide which sections this account can use. Until they are
    // known the gated entries stay hidden rather than showing and then
    // disappearing.
    api.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  // A link inside the drawer navigates but never closes it, so on a phone the
  // new page would open behind an opaque panel.
  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  const closeMobileNav = useCallback(() => setMobileNav(false), []);

  useEffect(() => {
    if (isDesktop || !mobileNav) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNav();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeMobileNav, isDesktop, mobileNav]);

  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (mobileNav) {
      drawerWasOpen.current = true;
      closeButton.current?.focus();
      return;
    }
    if (!drawerWasOpen.current) return;
    drawerWasOpen.current = false;
    // Deferred to this effect on purpose. The content column is `inert` while the
    // drawer is open, and an inert subtree cannot take focus — restoring focus
    // inside the click handler would land the keyboard on the body instead.
    if (!isDesktop) menuButton.current?.focus();
  }, [isDesktop, mobileNav]);

  const scopes = user?.scopes || [];
  const [primarySection, settingsSection] = getVisibleNavigation(scopes);
  const sidebarItems = [
    { label: t("shell.workspace"), heading: true as const },
    ...primarySection.groups.flatMap((group) => group.items).map((item) => ({ label: t(item.labelKey), href: item.href, icon: <Icon name={item.icon} size={16} /> })),
    {
      label: t(settingsSection.labelKey ?? "shell.settings"),
      group: true as const,
      href: settingsSection.href,
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
  const drawerVisible = isDesktop || mobileNav;

  async function logout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <div className="admin-shell min-h-[100dvh] bg-canvas">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand-fill focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand">{t("shell.skipToMain")}</a>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col overflow-y-auto overscroll-contain border-r border-[var(--line)] bg-surface px-3 py-4 transition-transform md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}
        inert={!drawerVisible ? true : undefined}
      >
        <div className="mb-6 flex shrink-0 items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-fill text-sm font-bold text-on-brand">P</div>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight text-[var(--ink)]">Purels</div>
            <div className="text-2xs text-[var(--muted)]">{t("shell.console")}</div>
          </div>
          <button ref={closeButton} type="button" className="icon-button ml-auto rounded p-1 text-muted md:hidden" onClick={closeMobileNav} aria-label={t("shell.closeMenu")}><Icon name="close" size={17} /></button>
        </div>
        <BounceSidebar items={sidebarItems} activeHref={pathname} matchesHref={isNavItemActive} dotColor="var(--brand-ink)" ariaLabel={t("shell.console")} expandLabel={t("shell.expandSection")} collapseLabel={t("shell.collapseSection")} className="min-h-0 px-1" />
        <div className="mt-auto shrink-0 border-t border-[var(--line)] pt-3">
          <AccountMenu
            scopes={scopes}
            username={username}
            secondaryLabel={roleLabel || t("shell.account")}
            avatar={avatar}
            loggingOut={loggingOut}
            onLogout={logout}
          />
        </div>
      </aside>
      {mobileNav && <button type="button" className="fixed inset-0 z-30 bg-[var(--scrim)] md:hidden" aria-label={t("shell.closeMenu")} onClick={closeMobileNav} />}
      <div className="md:pl-[232px]" inert={mobileNav ? true : undefined}>
        <header className="sticky top-0 z-20 flex h-14 items-center border-b border-[var(--line)] bg-surface/90 px-4 backdrop-blur md:hidden">
          <button ref={menuButton} type="button" className="icon-button grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-canvas" onClick={() => setMobileNav(true)} aria-label={t("shell.openMenu")} aria-expanded={mobileNav}><Icon name="menu" size={20} /></button>
        </header>
        <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
