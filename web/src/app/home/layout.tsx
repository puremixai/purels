import { AdminShell } from "@/components/admin-shell";

// The trackers are not mounted here: AnalyticsInjector sits in app/layout.tsx
// so that the landing page, sign-in and registration carry them too. Mounting
// it in both places would inject every snippet twice on console pages.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
