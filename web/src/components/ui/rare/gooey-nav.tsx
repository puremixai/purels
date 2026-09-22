"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type GooeyNavItem = string | { label: string; href?: string; icon?: ReactNode };

export type GooeyNavProps = {
  items: GooeyNavItem[];
  value?: number;
  defaultValue?: number;
  onChange?: (index: number) => void;
  size?: "sm" | "md" | "lg";
  activeColor?: string;
  ariaLabel?: string;
  className?: string;
};

export function GooeyNav({
  items,
  value,
  defaultValue = 0,
  onChange,
  size = "md",
  activeColor = "var(--ui-accent-fill)",
  ariaLabel = "Section navigation",
  className,
}: GooeyNavProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const reduceMotion = useReducedMotion();
  const activeIndex = value ?? internalValue;
  const sizeClass = size === "sm" ? "rare-gooey-nav-sm" : size === "lg" ? "rare-gooey-nav-lg" : "rare-gooey-nav-md";

  function select(index: number) {
    if (value === undefined) setInternalValue(index);
    onChange?.(index);
  }

  return (
    <nav aria-label={ariaLabel} className={cn("rare-gooey-nav", sizeClass, className)}>
      {items.map((item, index) => {
        const normalized = typeof item === "string" ? { label: item } : item;
        const active = index === activeIndex;
        const content = (
          <>
            {active && (
              <motion.span
                layoutId="purels-gooey-active"
                aria-hidden="true"
                className="rare-gooey-active"
                style={{ backgroundColor: activeColor }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 24 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2">
              {normalized.icon}
              {normalized.label}
            </span>
          </>
        );

        return normalized.href ? (
          <Link
            key={`${index}-${normalized.label}`}
            href={normalized.href}
            className="rare-gooey-item"
            aria-current={active ? "page" : undefined}
            data-active={active}
            onClick={() => select(index)}
          >
            {content}
          </Link>
        ) : (
          <button key={`${index}-${normalized.label}`} type="button" className="rare-gooey-item" onClick={() => select(index)} aria-pressed={active}>
            {content}
          </button>
        );
      })}
    </nav>
  );
}
