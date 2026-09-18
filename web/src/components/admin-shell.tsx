"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, roleLabels, type AdminUser } from "@/lib/api-client";
import { Icon, type IconName } from "./icon";

/**
 * Each entry names the scope that unlocks it, or none when every signed-in
 * account may use it. The API enforces the same scopes, so this only decides
 * what is worth showing.
 */
const navItems: Array<{ href: string; label: string; icon: IconName; scope?: string }> = [
  { href: "/admin", label: "概览", icon: "grid" },
  { href: "/admin/links", label: "链接管理", icon: "link" },
  { href: "/admin/stats", label: "数据统计", icon: "chart" },
  { href: "/admin/audit", label: "操作日志", icon: "list", scope: "audit:read" },
  { href: "/admin/users", label: "用户管理", icon: "user", scope: "users:manage" },
  { href: "/admin/settings/roles", label: "角色权限", icon: "key", scope: "roles:manage" },
  { href: "/admin/settings/oidc", label: "登录方式", icon: "lock", scope: "oidc:manage" },
  { href: "/admin/settings/analytics", label: "埋点统计", icon: "pulse", scope: "analytics:manage" },
  { href: "/admin/settings/security", label: "安全设置", icon: "shield" },
  { href: "/admin/settings/captcha", label: "注册保护", icon: "shield", scope: "captcha:manage" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
  const username = user?.username || "";
  const avatar = (username || "P").slice(0, 1).toUpperCase();
  const roleLabel = user?.role ? roleLabels[user.role] || user.role : "";

  async function logout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-[var(--line)] bg-white px-4 py-5 transition-transform md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-9 flex items-center gap-3 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand)] text-sm font-bold text-white">P</div>
          <div>
            <div className="font-semibold tracking-tight">Purels</div>
            <div className="text-[11px] text-[var(--muted)]">管理后台</div>
          </div>
          <button className="ml-auto rounded p-1 text-slate-400 md:hidden" onClick={() => setMobileNav(false)} aria-label="关闭菜单"><Icon name="close" size={17} /></button>
        </div>
        <nav className="space-y-1">
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">工作台</div>
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return <Link key={item.href} href={item.href} onClick={() => setMobileNav(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? "bg-[#edf0ff] text-[var(--brand)]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}><Icon name={item.icon} size={17} />{item.label}</Link>;
          })}
        </nav>
        <div className="mt-auto border-t border-[var(--line)] pt-4">
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-500 hover:bg-red-50 hover:text-red-600" disabled={loggingOut} onClick={logout}><Icon name="logout" size={17} />{loggingOut ? "正在退出..." : "退出登录"}</button>
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" aria-label="关闭菜单" onClick={() => setMobileNav(false)} />}
      <div className="md:pl-[238px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--line)] bg-white/90 px-5 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Icon name="menu" size={20} /></button>
          <div className="hidden text-sm text-slate-500 md:block">欢迎回来{username ? `，${username}` : ""}</div>
          <div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><div className="text-xs font-semibold">{username || "—"}</div><div className="text-[11px] text-slate-400">{roleLabel}</div></div><div className="grid h-9 w-9 place-items-center rounded-full bg-[#dfe5ff] text-xs font-bold text-[var(--brand)]">{avatar}</div></div>
        </header>
        <main className="mx-auto max-w-[1250px] px-5 py-7 md:px-8 md:py-9">{children}</main>
      </div>
    </div>
  );
}
