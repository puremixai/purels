import { AdminShell } from "@/components/admin-shell";
import { AnalyticsInjector } from "@/components/analytics-injector";

// AnalyticsInjector sits here rather than inside AdminShell because this file
// is the scope boundary: /login and /register are siblings of /admin, not
// children of it, so a snippet mounted here cannot reach them. It renders no
// DOM of its own — next/script appends to the document body — so being a
// sibling of the shell costs nothing.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalyticsInjector />
      <AdminShell>{children}</AdminShell>
    </>
  );
}
