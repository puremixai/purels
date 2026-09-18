"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, LinkRecord, LinkRuleInput } from "@/lib/api-client";
import { LinkDomainPicker } from "@/components/link-domain-picker";
import { LinkRulesEditor } from "@/components/link-rules-editor";
import { parseTags } from "@/lib/tags";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/** The stored rules, reduced to the fields the editor edits. */
function toRuleInputs(link: LinkRecord): LinkRuleInput[] {
  return (link.rules || []).map((rule) => ({
    match_type: rule.match_type,
    match_value: rule.match_value,
    destination_url: rule.destination_url,
    redirect_code: rule.redirect_code,
  }));
}

export default function EditLinkPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  const [link, setLink] = useState<LinkRecord | null>(null);
  const [shortUrl, setShortUrl] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [code, setCode] = useState("302");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("active");
  const [expires, setExpires] = useState("");
  const [rules, setRules] = useState<LinkRuleInput[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.links
      .get(id)
      .then(({ link: record, short_url }) => {
        if (cancelled) return;
        setLink(record);
        setShortUrl(short_url);
        setUrl(record.destination_url);
        setTitle(record.title || "");
        setTags((record.tags || []).join(", "));
        setCode(String(record.redirect_code));
        setDomain(record.domain || "");
        setStatus(record.status);
        setExpires(record.expires_at ? record.expires_at.slice(0, 10) : "");
        setRules(toRuleInputs(record));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function checkNow() {
    setChecking(true);
    setError("");
    try {
      const result = await api.links.check(id);
      setLink((current) =>
        current ? { ...current, last_checked_at: result.checked_at, last_status_code: result.status_code } : current,
      );
      // A destination that could not be reached at all is reported here rather
      // than stored: the recorded status code is 0.
      if (result.error) setError(result.error);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "检查失败");
    } finally {
      setChecking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.links.update(id, {
        destination_url: url,
        title,
        tags: parseTags(tags),
        redirect_code: Number(code),
        status,
        // An empty string clears the expiry; the API distinguishes it from "unchanged".
        expires_at: expires ? new Date(`${expires}T00:00:00Z`).toISOString() : "",
        rules,
        // Sent unconditionally: the form shows the whole state, so an empty
        // value here means "move it back to the default domain".
        domain,
      });
      router.push("/admin/links");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">工作台 / 链接管理 / 编辑</p>
        <h1 className="mt-1 text-2xl font-bold">编辑链接</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      {loading ? (
        <p className="panel p-6 text-sm text-[var(--muted)]">加载中…</p>
      ) : link ? (
        <div className="space-y-6">
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm text-[var(--muted)]">
              {link.last_checked_at
                ? `上次检查 ${formatTime(link.last_checked_at)}${link.last_status_code ? ` · ${link.last_status_code}` : " · 无法连接"}`
                : "尚未检查"}
            </span>
            <button type="button" className="btn-secondary" disabled={checking} onClick={checkNow}>
              {checking ? "检查中..." : "立即检查"}
            </button>
          </div>

          <form onSubmit={submit} className="panel space-y-5 p-6">
          <div>
            <span className="field-label">短链接</span>
            <p className="mt-1 font-medium">
              {link.domain ? `${link.domain}/` : "/"}
              {link.alias}
              {shortUrl && (
                <a
                  href={api.links.previewUrl(shortUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-3 text-sm font-normal text-[var(--brand)] hover:underline"
                >
                  预览
                </a>
              )}
            </p>
          </div>

          <LinkDomainPicker value={domain} onChange={setDomain} />

          <label className="block">
            <span className="field-label">目标 URL</span>
            <input required type="url" className="field-control" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">标题（可选）</span>
            <input className="field-control" maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">标签（可选）</span>
            <input className="field-control" placeholder="多个标签用逗号分隔" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">跳转状态码</span>
            <select className="field-control" value={code} onChange={(event) => setCode(event.target.value)}>
              <option value="302">302 临时跳转</option>
              <option value="301">301 永久跳转</option>
            </select>
          </label>

          <label className="block">
            <span className="field-label">状态</span>
            <select className="field-control" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>

          <label className="block">
            <span className="field-label">过期日期（留空为永久）</span>
            <input type="date" className="field-control" value={expires} onChange={(event) => setExpires(event.target.value)} />
          </label>

          <LinkRulesEditor rules={rules} onChange={setRules} />

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => router.back()}>取消</button>
            <button className="btn-primary" disabled={saving}>{saving ? "保存中..." : "保存修改"}</button>
          </div>
          </form>
        </div>
      ) : (
        <p className="panel p-6 text-sm text-[var(--muted)]">未找到该链接。</p>
      )}
    </div>
  );
}
