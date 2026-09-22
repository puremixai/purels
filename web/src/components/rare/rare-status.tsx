import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RareStatusTone = "neutral" | "success" | "warning" | "danger";

/**
 * A plain chip by default. `role="status"` is an aria-live region, so a table
 * that renders one per row would announce every cell on each refresh — pass a
 * role from the caller when a chip really is the page's status.
 */
export function RareStatus({ tone = "neutral", className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: RareStatusTone; children: ReactNode }) {
  return <span {...props} className={cn("rare-status", `rare-status-${tone}`, className)}>{children}</span>;
}
