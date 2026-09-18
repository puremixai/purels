"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, PublicProvider } from "@/lib/api-client";

/**
 * What a failed external sign-in can come back as. The API redirects to
 * /login?error=<code> with a fixed code rather than a message, because the
 * message can name an issuer or a host and this page is reachable without a
 * session.
 */
const OIDC_ERRORS: Record<string, string> = {
  // One message for "no account is bound and provisioning is off" and for "the
  // bound account is disabled": the API reports both as one code on purpose,
  // and a message that named only the first would be wrong half the time.
  oidc_not_provisioned: "无法为这个身份找到可用的账号，请联系管理员。",
  oidc_state: "这次登录已失效，请重新开始。",
  oidc_exchange: "身份提供方没有完成这次登录，请重试。",
  oidc_unavailable: "该登录方式当前不可用，请联系管理员。",
  oidc_failed: "登录失败，请重试。",
};

export default function LoginPage() {
  const router = useRouter();
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
  const [providers, setProviders] = useState<PublicProvider[]>([]);

  const verifying = Boolean(challenge) || cookieMfa;

  useEffect(() => {
    // Read the query from window.location rather than with useSearchParams: in
    // the App Router that hook needs a Suspense boundary, which would force
    // this page — the one that must stay statically rendered — to become
    // dynamic.
    const query = new URLSearchParams(window.location.search);
    if (query.get("mfa") === "1") setCookieMfa(true);
    const failed = query.get("error");
    if (failed) setError(OIDC_ERRORS[failed] || OIDC_ERRORS.oidc_failed);
    api.oidc.publicProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

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
    catch (err) { setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试"); }
    finally { setLoading(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    // challenge is empty on the external path, which is what tells the server
    // to take it from the cookie.
    try { await api.mfa.verify(challenge, code); router.replace("/admin"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "验证失败，请稍后重试"); setCode(""); }
    finally { setLoading(false); }
  }

  function restart() { setChallenge(""); setCookieMfa(false); setCode(""); setError(""); }

  return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5">
    <section className="panel w-full max-w-md p-8">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-lg font-bold text-white">P</div><div><h1 className="text-xl font-bold">Purels</h1><p className="text-sm text-[var(--muted)]">短链接管理后台</p></div></div>
      <h2 className="mb-6 text-lg font-semibold">{verifying ? "两步验证" : "登录"}</h2>
      {verifying
        ? <form onSubmit={verify} className="space-y-4">
            <label className="block"><span className="field-label">验证码</span><input required autoFocus autoComplete="one-time-code" className="field-control" value={code} onChange={e => setCode(e.target.value)} /></label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>{loading ? "验证中..." : "验证"}</button>
            <button type="button" className="w-full text-sm text-[var(--muted)] hover:text-slate-700" onClick={restart}>返回</button>
          </form>
        : <form onSubmit={submit} className="space-y-4">
            <label className="block"><span className="field-label">用户名</span><input required autoComplete="username" className="field-control" value={username} onChange={e => setUsername(e.target.value)} /></label>
            <label className="block"><span className="field-label">密码</span><input required type="password" autoComplete="current-password" className="field-control" value={password} onChange={e => setPassword(e.target.value)} /></label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>{loading ? "登录中..." : "登录"}</button>
          </form>}
      {/* After the form, and never inside it: the browser suite drives this page
          by position — the first two form inputs are the credentials and the
          first button in the form is the submit. A link out of the form is
          invisible to both, while a button, or any input, would not be. */}
      {!verifying && providers.length > 0 && <div className="mt-6">
        <p className="mb-4 text-center text-xs tracking-wider text-[var(--muted)]">或</p>
        <div className="space-y-2">
          {providers.map(provider => <a key={provider.slug} className="btn-secondary w-full" href={`/api/v1/auth/oidc/${provider.slug}/start`}>{provider.display_name}</a>)}
        </div>
      </div>}
      {!verifying && <p className="mt-6 text-center text-sm text-[var(--muted)]">没有账号？<Link className="text-[var(--brand)]" href="/register">注册</Link></p>}
    </section>
  </main>;
}
