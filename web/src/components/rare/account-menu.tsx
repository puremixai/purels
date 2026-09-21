"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useT } from "@/components/i18n-provider";
import { type Theme, useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  username: string;
  secondaryLabel: string;
  avatar: string;
  loggingOut: boolean;
  onLogout: () => void;
  className?: string;
};

const themeOptions: Array<{ value: Theme; icon: "sun" | "moon"; labelKey: "theme.light" | "theme.dark" }> = [
  { value: "light", icon: "sun", labelKey: "theme.light" },
  { value: "dark", icon: "moon", labelKey: "theme.dark" },
];

export function AccountMenu({
  username,
  secondaryLabel,
  avatar,
  loggingOut,
  onLogout,
  className,
}: AccountMenuProps) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  function closeAfterNavigation() {
    setOpen(false);
  }

  function handleLogout() {
    setOpen(false);
    onLogout();
  }

  return (
    <div ref={rootRef} className={cn("rare-account-menu", className)}>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="account-panel"
            id={panelId}
            role="dialog"
            aria-label={t("shell.accountMenu")}
            className="rare-account-popover"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            <div className="rare-account-summary">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{username || "Purels"}</p>
                <p className="truncate text-xs text-muted">{secondaryLabel || t("shell.account")}</p>
              </div>
              <button
                type="button"
                className="rare-account-logout"
                disabled={loggingOut}
                onClick={handleLogout}
              >
                <Icon name="logout" size={15} />
                <span>{loggingOut ? t("shell.loggingOut") : t("shell.logout")}</span>
              </button>
            </div>

            <div className="rare-account-divider" />

            <div className="rare-account-theme" role="group" aria-label={t("shell.theme")}>
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="rare-account-theme-button"
                  aria-pressed={theme === option.value}
                  aria-label={t(option.labelKey)}
                  title={t(option.labelKey)}
                  onClick={() => setTheme(option.value)}
                >
                  <Icon name={option.icon} size={17} />
                  <span className="sr-only">{t(option.labelKey)}</span>
                </button>
              ))}
            </div>

            <div className="rare-account-divider" />

            <div className="rare-account-actions">
              <Link className="rare-account-action" href="/home/settings" onClick={closeAfterNavigation}>
                <Icon name="settings" size={18} />
                <span>{t("shell.settings")}</span>
                <Icon name="arrow" size={15} className="ml-auto" />
              </Link>
              <div className="rare-account-action rare-account-language">
                <span className="rare-account-language-label inline-flex items-center gap-2">
                  <Icon name="globe" size={17} />
                  <span>{t("shell.language")}</span>
                </span>
                <LocaleSwitcher className="rare-account-locale" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        ref={triggerRef}
        type="button"
        className="rare-account-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="rare-account-avatar" aria-hidden="true">{avatar}</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-ink">{username || "Purels"}</span>
          <span className="block truncate text-xs text-muted">{secondaryLabel || t("shell.account")}</span>
        </span>
        <Icon name="chevronUp" size={18} className="rare-account-caret" />
      </button>
    </div>
  );
}
