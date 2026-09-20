"use client";

import { Icon } from "@/components/icon";
import { useT } from "@/components/i18n-provider";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const t = useT();
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="rare-theme-toggle"
      aria-label={t("theme.switch")}
      onClick={toggleTheme}
    >
      <Icon name={nextTheme === "light" ? "sun" : "moon"} size={16} />
      <span className="hidden sm:inline">{t(nextTheme === "light" ? "theme.light" : "theme.dark")}</span>
    </button>
  );
}
