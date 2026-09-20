import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RareStatus({ tone = "neutral", className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger"; children: ReactNode }) {
  return <span {...props} role={props.role ?? "status"} className={cn("rare-status", `rare-status-${tone}`, className)}>{children}</span>;
}
