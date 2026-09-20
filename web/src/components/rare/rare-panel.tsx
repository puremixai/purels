import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RarePanel({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section {...props} className={cn("rare-panel", className)}>{children}</section>;
}
