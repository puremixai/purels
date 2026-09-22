"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { ConsoleBreadcrumb } from "@/components/rare/console-breadcrumb";

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
          <ConsoleBreadcrumb parents={[{ label: t("account.title") }]} title={title} />
          <p className="console-page-description">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
