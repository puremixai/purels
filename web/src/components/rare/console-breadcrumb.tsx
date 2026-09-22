"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-provider";

type BreadcrumbParent = {
  label: string;
  href?: string;
};

type ConsoleBreadcrumbProps = {
  title: string;
  parents?: readonly BreadcrumbParent[];
};

export function ConsoleBreadcrumb({ title, parents = [] }: ConsoleBreadcrumbProps) {
  const t = useT();
  const ancestors = [{ label: t("shell.workspace"), href: "/home" }, ...parents];

  return (
    <nav className="console-breadcrumb" aria-label={t("shell.breadcrumb")}>
      <ol>
        {ancestors.map((parent, index) => (
          <li key={`${parent.href ?? parent.label}-${index}`}>
            {parent.href ? <Link href={parent.href}>{parent.label}</Link> : <span>{parent.label}</span>}
            <span className="console-breadcrumb-separator" aria-hidden="true">/</span>
          </li>
        ))}
        <li aria-current="page"><h1>{title}</h1></li>
      </ol>
    </nav>
  );
}
