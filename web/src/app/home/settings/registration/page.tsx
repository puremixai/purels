"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-provider";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsAccess, SettingsForbidden } from "@/components/settings/settings-access";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { RuntimeForm } from "@/components/settings/runtime-form";
import { CaptchaForm } from "@/components/settings/captcha-form";

export default function Page() {
  const t = useT();
  return <SettingsPage title={t("settings.registration.title")} description={t("settings.registration.description")}>
    <SettingsAccess>{scopes => <>
      <SettingsTabs group="registration" scopes={scopes} />
      {scopes.includes("settings:manage") && <RuntimeForm group="registration" />}
      {scopes.includes("captcha:manage") && <CaptchaForm />}
      {!scopes.some(scope => ["settings:manage", "captcha:manage", "oidc:manage"].includes(scope)) && <SettingsForbidden />}
      {scopes.includes("oidc:manage") && <Link className="settings-related-link" href="/home/settings/oidc">{t("settings.registration.oidcLink")}</Link>}
      {scopes.includes("settings:manage") && <Link className="settings-related-link" href="/home/settings/traffic">{t("settings.registration.limitsLink")}</Link>}
    </>}</SettingsAccess>
  </SettingsPage>;
}
