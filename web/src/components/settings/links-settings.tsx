"use client";
import { useT } from "@/components/i18n-provider";
import { SettingsPage } from "./settings-page";
import { RuntimeForm } from "./runtime-form";
import { SettingsTabs } from "./settings-tabs";

export function LinksSettings({ group }: { group: "creation" | "redirects" | "maintenance" }) {
  const t = useT();
  return <SettingsPage title={t("settings.links.title")} description={t("settings.links.description")}>
    <SettingsTabs group="links" scopes={["settings:manage"]} />
    <RuntimeForm group={group} />
  </SettingsPage>;
}
