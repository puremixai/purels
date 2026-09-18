"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Set once the password is accepted and a second factor is due. While it is
  // set, the password form is replaced rather than shown alongside.
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    try { await api.mfa.verify(challenge, code); router.replace("/admin"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "验证失败，请稍后重试"); setCode(""); }
    finally { setLoading(false); }
  }

  function restart() { setChallenge(""); setCode(""); setError(""); }

  return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-5">
    <section className="panel w-full max-w-md p-8">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)] text-lg font-bold text-white">P</div><div><h1 className="text-xl font-bold">Purels</h1><p className="text-sm text-[var(--muted)]">短链接管理后台</p></div></div>
      <h2 className="mb-6 text-lg font-semibold">{challenge ? "两步验证" : "登录"}</h2>
      {challenge
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
      {!challenge && <p className="mt-6 text-center text-sm text-[var(--muted)]">没有账号？<Link className="text-[var(--brand)]" href="/register">注册</Link></p>}
    </section>
  </main>;
}
