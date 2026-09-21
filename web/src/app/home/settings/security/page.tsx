"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { api, MFAEnrollment, MFAStatus, TokenRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText } from "@/lib/i18n";
import { OtpInput } from "@/components/ui/rare/otp-input";
import { DeleteButton } from "@/components/ui/rare/delete-button";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-page";

export default function SecurityPage() {
  const t = useT();
  const { toast } = useToast();
  const [tokens, setTokens] = useState<TokenRecord[]>([]); const [name, setName] = useState(""); const [secret, setSecret] = useState(""); const [error, setError] = useState("");

  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadTokens = useCallback(async () => { try { setTokens(await api.tokens.list()); } catch (e) { setError(errorText(t, e, "error.load")); } }, [t]);
  const loadStatus = useCallback(async () => { try { setStatus(await api.mfa.status()); } catch (e) { setMfaError(errorText(t, e, "error.load")); } }, [t]);

  useEffect(() => { loadTokens(); loadStatus(); }, [loadTokens, loadStatus]);

  async function create() { try { const result = await api.tokens.create(name); setSecret(result.secret); setName(""); await loadTokens(); toast({ kind: "success", title: t("settings.security.tokenCreated"), description: t("settings.security.tokenWarning") }); } catch (e) { setError(errorText(t, e, "error.create")); } }
  async function revoke(id: string) { try { await api.tokens.revoke(id); await loadTokens(); toast({ kind: "success", title: t("settings.security.tokenRevoked") }); } catch (e) { setError(errorText(t, e, "error.revoke")); } }

  async function run(action: () => Promise<void>) {
    setMfaBusy(true); setMfaError("");
    try { await action(); } catch (e) { setMfaError(errorText(t, e, "error.operation")); } finally { setMfaBusy(false); }
  }

  const startEnroll = () => run(async () => { setRecoveryCodes([]); setCode(""); setEnrollment(await api.mfa.enroll()); });
  const confirmEnroll = () => run(async () => {
    const result = await api.mfa.confirm(code);
    setRecoveryCodes(result.recovery_codes);
    setEnrollment(null); setCode("");
    await loadStatus();
    toast({ kind: "success", title: t("settings.security.enabled") });
  });
  const disable = () => run(async () => {
    await api.mfa.disable(password, code);
    setPassword(""); setCode(""); setEnrollment(null);
    await loadStatus();
    toast({ kind: "success", title: t("settings.security.notEnabled") });
  });
  const cancelEnroll = () => { setEnrollment(null); setCode(""); setMfaError(""); };

  return <SettingsPage
    group={t("nav.group.security")}
    title={t("settings.security.title")}
    description={t("settings.security.description")}
  >

    <SettingsSection
      title={t("settings.security.mfa")}
      status={<RareStatus tone={status?.enabled ? "success" : "neutral"}>{status?.enabled ? t("settings.security.enabled") : t("settings.security.notEnabled")}</RareStatus>}
    >

      {mfaError && <p className="console-alert" role="alert">{mfaError}</p>}

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
          <button className="btn-primary" onClick={confirmEnroll} disabled={mfaBusy || !code}>{t("settings.security.confirm")}</button>
          <button className="btn-secondary" onClick={cancelEnroll} disabled={mfaBusy}>{t("common.cancel")}</button>
        </div>
      </div>}

      {status?.available && !enrollment && recoveryCodes.length === 0 && status.enabled && <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[var(--muted)]">{t("settings.security.codesRemaining", { count: status.recovery_codes_remaining })}</p>
        <div className="flex flex-wrap gap-3">
          <input className="field-control w-auto" type="password" autoComplete="current-password" placeholder={t("settings.security.currentPassword")} value={password} onChange={e => setPassword(e.target.value)} />
          <OtpInput label={t("settings.security.code")} value={code} onChange={setCode} status={mfaError ? "error" : "idle"} />
          <button className="btn-danger" onClick={disable} disabled={mfaBusy || !password || !code}>{t("settings.security.turnOff")}</button>
        </div>
      </div>}

      {status?.available && !enrollment && recoveryCodes.length === 0 && !status.enabled && <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <button className="btn-primary" onClick={startEnroll} disabled={mfaBusy}>{status.pending ? t("settings.security.restart") : t("settings.security.turnOn")}</button>
      </div>}
    </SettingsSection>

    <SettingsSection title={t("settings.security.tokensTitle")} description={t("settings.security.tokensDescription")}>
      {error && <p className="console-alert" role="alert">{error}</p>}
      {secret && <div className="mb-4 rounded-lg border border-warning/20 bg-warning-tint p-4 text-sm text-warning"><p className="font-semibold">{t("settings.security.tokenWarning")}</p><code className="mt-2 block break-all">{secret}</code></div>}
      <div className="flex flex-wrap gap-3">
        <input className="field-control min-w-0 flex-1" placeholder={t("settings.security.tokenName")} value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-primary" onClick={create} disabled={!name}>{t("settings.security.create")}</button>
      </div>
    </SettingsSection>

    <SettingsSection title={t("settings.security.tokenList")}>
      {tokens.length ? tokens.map(token => <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 first:pt-0 last:border-0 last:pb-0" key={token.id}><div className="min-w-0"><p className="font-medium">{token.name}</p><p className="text-sm text-[var(--muted)]">{token.token_prefix}••••</p><p className="mt-1 flex flex-wrap gap-1">{(token.scopes || []).map(scope => <span key={scope} className="rounded bg-canvas px-1.5 py-0.5 text-2xs text-ink-soft">{scope}</span>)}</p></div><DeleteButton label={t("settings.security.revoke")} confirmLabel={t("settings.security.revoke")} cancelLabel={t("common.cancel")} onConfirm={() => revoke(token.id)} /></div>) : <p className="console-empty">{t("settings.security.noTokens")}</p>}
    </SettingsSection>
  </SettingsPage>;
}
