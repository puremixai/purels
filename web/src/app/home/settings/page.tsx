"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { getVisibleNavigation } from "@/components/admin-navigation";
import { Icon } from "@/components/icon";
import { useT } from "@/components/i18n-provider";
import { SettingsPage } from "@/components/settings/settings-page";

export default function SettingsHomePage() {
  const t = useT();
  const [scopes, setScopes] = useState<string[] | null>(null);

  useEffect(() => {
    api.auth.me()
      .then((user) => setScopes(user.scopes || []))
      .catch(() => setScopes([]));
  }, []);

  const settings = getVisibleNavigation(scopes || []).find((section) => section.id === "settings");
  const groups = settings?.groups.filter((group) => group.id !== "overview" && group.labelKey) || [];

  return (
    <SettingsPage
      title={t("settings.home.title")}
      description={t("settings.home.description")}
    >
      {scopes === null ? (
        <div className="settings-home-grid" role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 4 }, (_, index) => <span className="console-panel console-skeleton h-48" key={index} />)}
        </div>
      ) : groups.length ? (
        <div className="settings-home-grid">
          {groups.map((group) => (
            <section className="settings-home-group" key={group.id}>
              <div className="settings-home-group-header">
                <span className="settings-home-group-icon" aria-hidden="true">
                  <Icon name={group.items[0]?.icon || "settings"} size={17} />
                </span>
                <div className="min-w-0">
                  <h2 className="settings-home-group-title">{t(group.labelKey!)}</h2>
                  {group.descriptionKey && <p className="settings-home-group-description">{t(group.descriptionKey)}</p>}
                </div>
                <span className="settings-home-count">{t("settings.home.pageCount", { count: group.items.length })}</span>
              </div>
              <div className="settings-home-items">
                {group.items.map((item) => (
                  <Link className="settings-home-item" href={item.href} key={item.href}>
                    <span className="settings-home-item-icon" aria-hidden="true">
                      <Icon name={item.icon} size={16} />
                    </span>
                    <span className="settings-home-item-copy">
                      <span className="settings-home-item-title">{t(item.labelKey)}</span>
                      {item.descriptionKey && <span className="settings-home-item-description">{t(item.descriptionKey)}</span>}
                    </span>
                    <Icon name="arrow" size={15} className="text-[var(--muted)]" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="console-empty">{t("settings.home.noAccess")}</p>
      )}
    </SettingsPage>
  );
}
