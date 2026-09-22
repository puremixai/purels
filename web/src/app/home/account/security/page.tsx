"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { api, MFAEnrollment, MFAStatus } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText } from "@/lib/i18n";
import { OtpInput } from "@/components/ui/rare/otp-input";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsSection } from "@/components/settings/settings-page";
import { AccountPage } from "@/components/personal/account-page";

export default function SecurityPage() {
  const t = useT();
  const { toast } = useToast();

  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setMfaError("");
    try { setStatus(await api.mfa.status()); }
    catch (e) { setMfaError(errorText(t, e, "error.load")); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function run(action: () => Promise<void>) {
    setMfaBusy(true); setMfaError("");
    try { await action(); } catch (e) { setMfaError(errorText(t, e, "error.operation")); } finally { setMfaBusy(false); }
  }

  const startEnroll = () => run(async () => { setRecoveryCodes([]); setCode(""); setEnrollment(await api.mfa.enroll()); });
  const confirmEnroll = () => run(async () => {
    const result = await api.mfa.confirm(code);
    setStatus(current => current && { ...current, enabled: true, pending: false, recovery_codes_remaining: result.recovery_codes.length });
    setRecoveryCodes(result.recovery_codes);
    setEnrollment(null); setCode("");
    await loadStatus();
    toast({ kind: "success", title: t("settings.security.enabled") });
  });
  const disable = () => run(async () => {
    await api.mfa.disable(password, code);
    setStatus(current => current && { ...current, enabled: false, pending: false, recovery_codes_remaining: 0 });
    setPassword(""); setCode(""); setEnrollment(null);
    await loadStatus();
    toast({ kind: "success", title: t("settings.security.notEnabled") });
  });
  const cancelEnroll = () => { setEnrollment(null); setCode(""); setMfaError(""); };

  return <AccountPage
    title={t("account.security")}
    description={t("account.securityDescription")}
  >

    <SettingsSection
      title={t("settings.security.mfa")}
      status={status?.available && <RareStatus tone={status.enabled ? "success" : "neutral"}>{status.enabled ? t("settings.security.enabled") : t("settings.security.notEnabled")}</RareStatus>}
    >

      {mfaError && <div className="console-alert" role="alert">
        <p>{mfaError}</p>
        {!status && <button className="btn-secondary mt-3" disabled={loading} onClick={loadStatus}>{t("common.retry")}</button>}
      </div>}
      {loading && <p className="text-sm text-muted" role="status">{t("common.loading")}</p>}

      {status && !status.available && <p className="text-sm text-[var(--muted)]">{t("settings.security.unavailable")}</p>}

      {status?.available && recoveryCodes.length > 0 && <div className="space-y-3 rounded-lg border border-warning/20 bg-warning-tint p-4 text-sm text-warning">
        <p className="font-semibold">{t("settings.security.recoveryWarning")}</p>
        <div className="grid grid-cols-2 gap-1 font-mono">{recoveryCodes.map(c => <span key={c}>{c}</span>)}</div>
        <button className="btn-secondary" onClick={() => setRecoveryCodes([])}>{t("settings.security.recoverySaved")}</button>
      </div>}

      {status?.available && enrollment && recoveryCodes.length === 0 && <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-5">
          <Image alt={t("settings.security.qrAlt")} className="h-40 w-40 rounded-lg border border-[var(--line)] bg-surface p-1" height={160} src={enrollment.qr} unoptimized width={160} />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="text-[var(--muted)]">{t("settings.security.secret")}</p>
            <code className="block break-all font-mono text-xs">{enrollment.secret}</code>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <OtpInput label={t("settings.security.code")} value={code} onChange={setCode} status={mfaError ? "error" : "idle"} />
          <button className="btn-primary" onClick={confirmEnroll} disabled={mfaBusy || code.length !== 6}>{mfaBusy ? t("common.saving") : t("settings.security.confirm")}</button>
          <button className="btn-secondary" onClick={cancelEnroll} disabled={mfaBusy}>{t("common.cancel")}</button>
        </div>
      </div>}

      {status?.available && !enrollment && recoveryCodes.length === 0 && status.enabled && <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[var(--muted)]">{t("settings.security.codesRemaining", { count: status.recovery_codes_remaining })}</p>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 space-y-2 text-sm">
            <span className="block">{t("settings.security.currentPassword")}</span>
            <input className="field-control" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <OtpInput label={t("settings.security.code")} value={code} onChange={setCode} status={mfaError ? "error" : "idle"} />
          <button className="btn-danger self-end" onClick={disable} disabled={mfaBusy || !password || code.length !== 6}>{mfaBusy ? t("common.saving") : t("settings.security.turnOff")}</button>
        </div>
      </div>}

      {status?.available && !enrollment && recoveryCodes.length === 0 && !status.enabled && <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <button className="btn-primary" onClick={startEnroll} disabled={mfaBusy}>{mfaBusy ? t("common.loading") : status.pending ? t("settings.security.restart") : t("settings.security.turnOn")}</button>
      </div>}
    </SettingsSection>

  </AccountPage>;
}
