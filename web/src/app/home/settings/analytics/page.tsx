"use client";
import { useT } from "@/components/i18n-provider";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsAccess, SettingsForbidden } from "@/components/settings/settings-access";
import { RuntimeForm } from "@/components/settings/runtime-form";
import { TrackingForm } from "@/components/settings/tracking-form";
export default function Page() {
  const t = useT();
  return <SettingsPage title={t("settings.statistics.pageTitle")} description={t("settings.statistics.pageDescription")}>
    <SettingsAccess>{scopes => <>
      {scopes.includes("settings:manage") && <RuntimeForm group="statistics" />}
      {scopes.includes("analytics:manage") && <TrackingForm />}
      {!scopes.some(scope => ["settings:manage", "analytics:manage"].includes(scope)) && <SettingsForbidden />}
    </>}</SettingsAccess>
  </SettingsPage>;
}
