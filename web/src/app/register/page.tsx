"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { TurnstileWidget } from "@/components/turnstile-widget";
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
    try { await api.auth.register(username, password, captchaToken); router.replace("/admin"); }
    catch (err) {
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
      setError(errorText(t, err, "register.failed"));
    }
    finally { setLoading(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5">
    <section className="panel w-full max-w-md p-8">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-lg font-bold text-white">P</div><div><h1 className="text-xl font-bold">Purels</h1><p className="text-sm text-[var(--muted)]">{t("login.subtitle")}</p></div></div>
      <h2 className="mb-6 text-lg font-semibold">{t("register.heading")}</h2>
      {captchaError && <p className="mb-4 rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{captchaError}</p>}
      {registrationClosed ? (
        <p className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">{t("error.registration_disabled")}</p>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <label className="block"><span className="field-label">{t("register.username")}</span><input required autoComplete="username" className="field-control" value={username} onChange={e => setUsername(e.target.value)} /></label>
            <label className="block"><span className="field-label">{t("register.password")}</span><input required minLength={12} type="password" autoComplete="new-password" className="field-control" value={password} onChange={e => setPassword(e.target.value)} /></label>
            {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={loading || captchaLoading || Boolean(captchaError) || (captchaRequired && !captchaToken)}>{loading ? t("register.submitting") : t("register.submit")}</button>
          </form>
          {captchaRequired && captcha?.site_key && (
            <div className="mt-4">
              <TurnstileWidget siteKey={captcha.site_key} resetSignal={captchaReset} onTokenChange={setCaptchaToken} onError={setCaptchaError} />
            </div>
          )}
        </>
      )}
      <p className="mt-6 flex items-center justify-center gap-1 text-sm text-[var(--muted)]"><span>{t("register.haveAccount")}</span><Link className="text-[var(--brand)]" href="/login">{t("register.login")}</Link></p>
      {/* Outside the form, for the same reason the login page keeps its own
          switcher there: the suite counts the form's inputs and buttons. */}
      <div className="mt-6 border-t border-[var(--line)] pt-4">
        <LocaleSwitcher className="field-control text-sm text-ink-soft" />
      </div>
    </section>
  </main>;
}
