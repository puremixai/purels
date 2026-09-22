"use client";

import { useEffect, type ReactNode } from "react";
import { SettingsDraftGuard } from "./settings-draft-guard";
import { useT } from "@/components/i18n-provider";
import { ConsoleBreadcrumb } from "@/components/rare/console-breadcrumb";
import { cn } from "@/lib/utils";

type SettingsPageProps = {
  root?: boolean;
  group?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function SettingsPage({ root = false, group, title, description, actions, children }: SettingsPageProps) {
  const t = useT();
  const parents = root ? [] : [
    { label: t("shell.settings"), href: "/home/settings" },
    ...(group ? [{
      label: group,
      href: group === t("settings.registration.title") ? "/home/settings/registration" : undefined,
    }] : []),
  ];

  return (
    <div className="console-page settings-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <ConsoleBreadcrumb parents={parents} title={title} />
          <p className="console-page-description">{description}</p>
        </div>
        {actions && <div className="console-actions">{actions}</div>}
      </div>
      <SettingsDraftGuard>{children}</SettingsDraftGuard>
    </div>
  );
}

type SettingsSectionProps = {
  id?: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SettingsSection({ id, title, description, status, actions, className, children }: SettingsSectionProps) {
  useEffect(() => {
    if (id && window.location.hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return (
    <section id={id} className={cn("console-panel settings-section", className)}>
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
