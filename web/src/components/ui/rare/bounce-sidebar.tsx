"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BounceSidebarItem =
  | string
  | { label: string; href?: string; icon?: ReactNode }
  | { label: string; heading: true }
  | {
      label: string;
      group: true;
      icon?: ReactNode;
      sections: Array<{
        label: string;
        items: Array<{ label: string; href: string; icon?: ReactNode }>;
      }>;
      defaultOpen?: boolean;
    };

export type BounceSidebarProps = {
  items: BounceSidebarItem[];
  value?: number;
  defaultValue?: number;
  activeHref?: string;
  onChange?: (index: number) => void;
  dotColor?: string;
  ariaLabel?: string;
  className?: string;
};

export function BounceSidebar({
  items,
  value,
  defaultValue = 0,
  activeHref,
  onChange,
  dotColor = "var(--ui-accent)",
  ariaLabel = "Primary navigation",
  className,
}: BounceSidebarProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});
  const activeIndex = value ?? internalValue;
  const reduceMotion = useReducedMotion();

  function select(index: number) {
    if (value === undefined) setInternalValue(index);
    onChange?.(index);
  }

  function isActiveHref(href: string) {
    return href === "/home"
      ? activeHref === href
      : Boolean(activeHref && (activeHref === href || activeHref.startsWith(`${href}/`)));
  }

  function toggleGroup(index: number, open: boolean) {
    setOpenGroups((current) => ({ ...current, [index]: !open }));
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

          if (typeof item !== "string" && "group" in item) {
            const childActive = item.sections.some((section) => section.items.some((child) => isActiveHref(child.href)));
            const open = openGroups[index] ?? item.defaultOpen ?? childActive;
            const groupId = `rare-sidebar-group-${index}`;

            return (
              <li key={`${index}-${label}`} className="rare-sidebar-group">
                <button
                  type="button"
                  className="rare-sidebar-item rare-sidebar-group-trigger"
                  data-active={childActive}
                  data-group-active={childActive}
                  aria-expanded={open}
                  aria-controls={groupId}
                  onClick={() => toggleGroup(index, open)}
                >
                  <span className="relative z-10 inline-flex min-w-0 items-center gap-3">{item.icon}{label}</span>
                  <span aria-hidden="true" className="rare-sidebar-chevron" data-open={open}>⌄</span>
                </button>
                {open && (
                  <ul id={groupId} className="rare-sidebar-subnav">
                    {item.sections.map((section) => (
                      <li key={section.label} className="rare-sidebar-subsection">
                        <div className="rare-sidebar-subheading">{section.label}</div>
                        <ul className="rare-sidebar-subsection-items">
                          {section.items.map((child) => {
                            const active = isActiveHref(child.href);
                            return (
                              <li key={child.href}>
                                <Link
                                  href={child.href}
                                  aria-current={active ? "page" : undefined}
                                  data-active={active}
                                  className="rare-sidebar-item rare-sidebar-subitem"
                                  onClick={() => select(index)}
                                >
                                  {active && (
                                    <motion.span
                                      layoutId="purels-sidebar-marker"
                                      aria-hidden="true"
                                      className="rare-sidebar-marker"
                                      style={{ backgroundColor: dotColor }}
                                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 28 }}
                                    />
                                  )}
                                  <span className="relative z-10 inline-flex min-w-0 items-center gap-3">{child.icon}{child.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          }

          const href = typeof item === "string" ? undefined : item.href;
          const icon = typeof item === "string" ? null : item.icon;
          const active = activeHref ? isActiveHref(href || "") : activeIndex === index;
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
