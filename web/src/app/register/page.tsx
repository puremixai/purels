"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type PublicCaptchaSettings } from "@/lib/api-client";
import { TurnstileWidget } from "@/components/turnstile-widget";

export default function RegisterPage() {
  const router = useRouter();
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
      .catch((err) => setCaptchaError(err instanceof ApiError ? err.message : "无法加载注册验证"))
      .finally(() => setCaptchaLoading(false));
  }, []);

  const captchaRequired = captcha?.enabled === true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaRequired && !captchaToken) {
      setError("请完成验证");
      return;
    }
    setLoading(true); setError("");
    try { await api.auth.register(username, password, captchaToken); router.replace("/admin"); }
    catch (err) {
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
      setError(err instanceof ApiError ? err.message : "注册失败，请稍后重试");
    }
    finally { setLoading(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5">
    <section className="panel w-full max-w-md p-8">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-lg font-bold text-white">P</div><div><h1 className="text-xl font-bold">Purels</h1><p className="text-sm text-[var(--muted)]">短链接管理后台</p></div></div>
      <h2 className="mb-6 text-lg font-semibold">注册</h2>
      {captchaError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{captchaError}</p>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="field-label">用户名</span><input required autoComplete="username" className="field-control" value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label className="block"><span className="field-label">密码</span><input required minLength={12} type="password" autoComplete="new-password" className="field-control" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={loading || captchaLoading || Boolean(captchaError) || (captchaRequired && !captchaToken)}>{loading ? "注册中..." : "注册"}</button>
      </form>
      {captchaRequired && captcha?.site_key && (
        <div className="mt-4">
          <TurnstileWidget siteKey={captcha.site_key} resetSignal={captchaReset} onTokenChange={setCaptchaToken} onError={setCaptchaError} />
        </div>
      )}
      <p className="mt-6 text-center text-sm text-[var(--muted)]">已有账号？<Link className="text-[var(--brand)]" href="/login">登录</Link></p>
    </section>
  </main>;
}
