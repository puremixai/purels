"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { FluidOrb } from "@/components/ui/rare/fluid-orb";
import { api, type PublicCaptchaSettings } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState<PublicCaptchaSettings | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(true);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    api.captcha.publicSettings()
      .then((settings) => {
        setCaptcha(settings);
        setCaptchaError("");
      })
      .catch((err) => setCaptchaError(errorText(t, err, "register.captchaLoadFailed")))
      .finally(() => setCaptchaLoading(false));
    // t is stable per locale, so this still runs once on mount.
  }, [t]);

  const captchaRequired = captcha?.enabled === true;
  /**
   * The deployment has sign-up closed. The API refuses the request anyway, so
   * this only saves the visitor from filling in a form that cannot succeed.
   */
  const registrationClosed = captcha?.registration_enabled === false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaRequired && !captchaToken) {
      setError(t("register.completeCaptcha"));
      return;
    }
    setLoading(true); setError("");
    try { await api.auth.register(username, password, captchaToken); router.replace("/home"); }
    catch (err) {
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
      setError(errorText(t, err, "register.failed"));
    }
    finally { setLoading(false); }
  }

  return <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[var(--canvas)] px-5 py-6">
    <div className="pointer-events-none absolute -left-32 top-1/2 -translate-y-1/2 opacity-20 blur-2xl"><FluidOrb size={480} color="var(--brand)" /></div>
    <section className="panel relative z-10 w-full max-w-md p-6 sm:p-7">
      <div className="mb-6 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-fill text-lg font-bold text-on-brand">P</div><div><h1 className="text-xl font-bold tracking-tight">Purels</h1><p className="text-sm text-[var(--muted)]">{t("login.subtitle")}</p></div></div>
      <h2 className="mb-4 text-lg font-semibold">{t("register.heading")}</h2>
      {captchaError && <p className="console-alert mb-3" role="alert">{captchaError}</p>}
      {registrationClosed ? (
        <p className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">{t("error.registration_disabled")}</p>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-3">
            <label className="block"><span className="field-label">{t("register.username")}</span><input required autoComplete="username" className="field-control" value={username} onChange={e => setUsername(e.target.value)} /></label>
            <label className="block"><span className="field-label">{t("register.password")}</span><input required minLength={12} type="password" autoComplete="new-password" className="field-control" value={password} onChange={e => setPassword(e.target.value)} /></label>
            {error && <p className="console-alert" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={loading || captchaLoading || Boolean(captchaError) || (captchaRequired && !captchaToken)}>{loading ? t("register.submitting") : t("register.submit")}</button>
          </form>
          {captchaRequired && captcha?.site_key && (
            <div className="mt-4">
              <TurnstileWidget siteKey={captcha.site_key} resetSignal={captchaReset} onTokenChange={setCaptchaToken} onError={setCaptchaError} />
            </div>
          )}
        </>
      )}
      <p className="mt-4 flex items-center justify-center gap-1 text-sm text-[var(--muted)]"><span>{t("register.haveAccount")}</span><Link className="text-[var(--brand)]" href="/login">{t("register.login")}</Link></p>
      {/* Outside the form, for the same reason the login page keeps its own
          switcher there: the suite counts the form's inputs and buttons. */}
      <div className="mt-4 border-t border-[var(--line)] pt-3">
        <LocaleSwitcher className="field-control text-sm text-ink-soft" />
      </div>
    </section>
  </main>;
}
