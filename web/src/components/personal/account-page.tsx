"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/i18n-provider";

type AccountPageProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AccountPage({ title, description, children }: AccountPageProps) {
  const t = useT();

  return (
    <div className="console-page settings-page">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")} / {t("account.title")}</p>
          <h1 className="console-page-title">{title}</h1>
          <p className="console-page-description">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
