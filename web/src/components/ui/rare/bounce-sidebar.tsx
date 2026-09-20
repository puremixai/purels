"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BounceSidebarItem =
  | string
  | { label: string; href?: string; icon?: ReactNode }
  | { label: string; heading: true };

export type BounceSidebarProps = {
  items: BounceSidebarItem[];
  value?: number;
  defaultValue?: number;
  onChange?: (index: number) => void;
  dotColor?: string;
  ariaLabel?: string;
  className?: string;
};

export function BounceSidebar({
  items,
  value,
  defaultValue = 0,
  onChange,
  dotColor = "var(--ui-accent)",
  ariaLabel = "Primary navigation",
  className,
}: BounceSidebarProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeIndex = value ?? internalValue;
  const reduceMotion = useReducedMotion();

  function select(index: number) {
    if (value === undefined) setInternalValue(index);
    onChange?.(index);
  }

  return (
    <nav aria-label={ariaLabel} className={cn("rare-sidebar-nav", className)}>
      <ul className="relative grid gap-1">
        {items.map((item, index) => {
          const label = typeof item === "string" ? item : item.label;
          if (typeof item !== "string" && "heading" in item) {
            return (
              <li
                key={`${index}-${label}`}
                className="rare-sidebar-heading"
                style={{ color: dotColor }}
              >
                {label}
              </li>
            );
          }

          const href = typeof item === "string" ? undefined : item.href;
          const icon = typeof item === "string" ? null : item.icon;
          const active = activeIndex === index;
          const content = (
            <>
              {active && (
                <motion.span
                  layoutId="purels-sidebar-marker"
                  aria-hidden="true"
                  className="rare-sidebar-marker"
                  style={{ backgroundColor: dotColor }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 28 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-3">{icon}{label}</span>
            </>
          );

          return (
            <li key={`${index}-${label}`}>
              {href ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  data-active={active}
                  className="rare-sidebar-item"
                  onClick={() => select(index)}
                >
                  {content}
                </Link>
              ) : (
                <button type="button" data-active={active} className="rare-sidebar-item" onClick={() => select(index)}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
