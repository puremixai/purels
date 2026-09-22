"use client";
import { useT } from "@/components/i18n-provider";
import { SettingsPage } from "@/components/settings/settings-page";
import { RuntimeForm } from "@/components/settings/runtime-form";
export default function Page() {
  const t = useT();
  return <SettingsPage title={t("settings.traffic.title")} description={t("settings.runtime.rateDescription")}><RuntimeForm group="traffic" /></SettingsPage>;
}
