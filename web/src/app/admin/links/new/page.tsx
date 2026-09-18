"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, LinkRuleInput } from "@/lib/api-client";
import { LinkRulesEditor } from "@/components/link-rules-editor";

/** "News, promo  news" -> ["news", "promo"] — split, trim, drop blanks, de-dupe. */
function parseTags(raw: string) {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，\s]+/)) {
    const name = part.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

export default function NewLinkPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [code, setCode] = useState("302");
  const [rules, setRules] = useState<LinkRuleInput[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.links.create({
        destination_url: url,
        alias: alias || undefined,
        title: title || undefined,
        tags: parseTags(tags),
        redirect_code: Number(code),
        rules,
      });
      router.push("/admin/links");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">工作台 / 链接管理</p>
        <h1 className="mt-1 text-2xl font-bold">创建链接</h1>
      </div>
      <form onSubmit={submit} className="panel space-y-5 p-6">
        <label className="block">
          <span className="field-label">目标 URL</span>
          <input required type="url" className="field-control" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">自定义别名（可选）</span>
          <input className="field-control" placeholder="留空自动生成" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">标题（可选）</span>
          <input className="field-control" maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">标签（可选）</span>
          <input className="field-control" placeholder="多个标签用逗号分隔" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">跳转状态码</span>
          <select className="field-control" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="302">302 临时跳转</option>
            <option value="301">301 永久跳转</option>
          </select>
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <LinkRulesEditor rules={rules} onChange={setRules} />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>取消</button>
          <button className="btn-primary" disabled={loading}>{loading ? "创建中..." : "创建链接"}</button>
        </div>
      </form>
    </div>
  );
}
