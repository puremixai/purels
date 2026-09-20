"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { FluidOrb } from "@/components/ui/rare/fluid-orb";
import { OtpInput } from "@/components/ui/rare/otp-input";
import { useT } from "@/components/i18n-provider";
import { api, PublicProvider } from "@/lib/api-client";
import { errorText, hasMessage } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Set once the password is accepted and a second factor is due. While it is
  // set, the password form is replaced rather than shown alongside.
  const [challenge, setChallenge] = useState("");
  // Set when the second factor is due after an external sign-in. The challenge
  // is not here — it is in an HttpOnly cookie the page cannot read, so the
  // request goes out without one and the server fills it in.
  const [cookieMfa, setCookieMfa] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  // A failed external sign-in comes back as a code in the query rather than a
  // message, because the message could name an issuer or a host and this page is
  // reachable without a session. The code is kept and translated at render, so
  // changing the language re-words it.
  const [failureCode, setFailureCode] = useState("");

  const verifying = Boolean(challenge) || cookieMfa;

  useEffect(() => {
    let active = true;

    async function initialise() {
      try {
        await api.auth.me();
        if (active) router.replace("/admin");
        return;
      } catch {
        // A missing or expired session is the normal anonymous path. The API
        // client deliberately does not redirect a 401 while already on /login.
      }

      if (!active) return;
      // Read the query from window.location rather than with useSearchParams: that
      // hook needs a Suspense boundary in the App Router, and there is nothing here
      // worth suspending for — the query is read once, after the session check.
      const query = new URLSearchParams(window.location.search);
      if (query.get("mfa") === "1") setCookieMfa(true);
      setFailureCode(query.get("error") || "");
      setCheckingSession(false);
      api.oidc.publicProviders()
        .then((nextProviders) => {
          if (active) setProviders(nextProviders);
        })
        .catch(() => {
          if (active) setProviders([]);
        });
    }

    void initialise();
    return () => {
      active = false;
    };
  }, [router]);

  const failureKey = failureCode ? `oidcError.${failureCode}` : "";
  const oidcFailure = failureCode ? t(hasMessage(failureKey) ? failureKey : "oidcError.oidc_failed") : "";
  const shownError = error || oidcFailure;

  if (checkingSession) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--canvas)] px-5">
      <section className="panel w-full max-w-md p-8 text-center text-sm text-[var(--muted)]">
        {t("common.loading")}
      </section>
    </main>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await api.auth.login(username, password);
      if (result.mfa_required && result.challenge) {
        setChallenge(result.challenge);
        setCode("");
        return;
      }
      router.replace("/admin");
    }
    catch (err) { setError(errorText(t, err, "login.failed")); }
    finally { setLoading(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    // challenge is empty on the external path, which is what tells the server
    // to take it from the cookie.
    try { await api.mfa.verify(challenge, code); router.replace("/admin"); }
    catch (err) { setError(errorText(t, err, "login.verifyFailed")); setCode(""); }
    finally { setLoading(false); }
  }

  function restart() { setChallenge(""); setCookieMfa(false); setCode(""); setError(""); }

  return <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[var(--canvas)] px-5 py-8">
    <div className="pointer-events-none absolute -right-32 top-1/2 -translate-y-1/2 opacity-20 blur-2xl"><FluidOrb size={480} color="var(--brand)" /></div>
    <section className="panel relative z-10 w-full max-w-md p-7 sm:p-8">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--brand)] text-lg font-bold text-[#100b08]">P</div><div><h1 className="text-xl font-bold tracking-tight">Purels</h1><p className="text-sm text-[var(--muted)]">{t("login.subtitle")}</p></div></div>
      <h2 className="mb-6 text-lg font-semibold">{verifying ? t("login.mfaHeading") : t("login.heading")}</h2>
      {verifying
        ? <form onSubmit={verify} className="space-y-4">
            <label className="block"><span className="field-label">{t("login.code")}</span><OtpInput required autoFocus length={6} value={code} onChange={setCode} status={shownError ? "error" : "idle"} label={t("login.code")} /></label>
            {shownError && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{shownError}</p>}
            <button className="btn-primary w-full" disabled={loading}>{loading ? t("login.verifying") : t("login.verify")}</button>
            <button type="button" className="w-full text-sm text-[var(--muted)] hover:text-ink-soft" onClick={restart}>{t("login.back")}</button>
          </form>
        : <form onSubmit={submit} className="space-y-4">
            <label className="block"><span className="field-label">{t("login.username")}</span><input required autoComplete="username" className="field-control" value={username} onChange={e => setUsername(e.target.value)} /></label>
            <label className="block"><span className="field-label">{t("login.password")}</span><input required type="password" autoComplete="current-password" className="field-control" value={password} onChange={e => setPassword(e.target.value)} /></label>
            {shownError && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{shownError}</p>}
            <button className="btn-primary w-full" disabled={loading}>{loading ? t("login.submitting") : t("login.submit")}</button>
          </form>}
      {/* After the form, and never inside it: the browser suite drives this page
          by position — the first two form inputs are the credentials and the
          first button in the form is the submit. A link out of the form is
          invisible to both, while a button, or any input, would not be. */}
      {!verifying && providers.length > 0 && <div className="mt-6">
        <p className="mb-4 text-center text-xs tracking-wider text-[var(--muted)]">{t("login.or")}</p>
        <div className="space-y-2">
          {providers.map(provider => <a key={provider.slug} className="btn-secondary w-full" href={`/api/v1/auth/oidc/${provider.slug}/start`}>{provider.display_name}</a>)}
        </div>
      </div>}
      {!verifying && <p className="mt-6 flex items-center justify-center gap-1 text-sm text-[var(--muted)]"><span>{t("login.noAccount")}</span><Link className="text-[var(--brand)]" href="/register">{t("login.register")}</Link></p>}
      {/* Outside the form on purpose: the switcher is a select, and an input
          inside the form would change the shape the suite asserts on. */}
      <div className="mt-6 border-t border-[var(--line)] pt-4">
        <LocaleSwitcher className="field-control text-sm text-ink-soft" />
      </div>
    </section>
  </main>;
}
