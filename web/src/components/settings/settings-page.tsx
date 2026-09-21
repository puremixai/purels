"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

type SettingsPageProps = {
  group?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function SettingsPage({ group, title, description, actions, children }: SettingsPageProps) {
  const t = useT();

  return (
    <div className="console-page settings-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")} / {t("shell.settings")}{group ? ` / ${group}` : ""}</p>
          <h1 className="console-page-title">{title}</h1>
          <p className="console-page-description">{description}</p>
        </div>
        {actions && <div className="console-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

type SettingsSectionProps = {
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SettingsSection({ title, description, status, actions, className, children }: SettingsSectionProps) {
  return (
    <section className={cn("console-panel settings-section", className)}>
      <div className="settings-section-header">
        <div className="min-w-0">
          <div className="settings-section-title-row">
            <h2 className="console-panel-title">{title}</h2>
            {status}
          </div>
          {description && <p className="settings-section-description">{description}</p>}
        </div>
        {actions && <div className="settings-section-actions">{actions}</div>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}
