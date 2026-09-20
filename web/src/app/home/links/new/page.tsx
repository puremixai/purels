"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { api, LinkRecord, LinkRuleInput } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";
import { CopyLinkButton } from "@/components/copy-link-button";
import { LinkDomainPicker } from "@/components/link-domain-picker";
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

type CreatedLink = { link: LinkRecord; short_url: string };

export default function NewLinkPage() {
  const router = useRouter();
  const t = useT();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [domain, setDomain] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [code, setCode] = useState("302");
  // On by default, matching the column default: the point of the option is that
  // a visitor sees where they are going unless the operator says otherwise.
  const [interstitialOn, setInterstitialOn] = useState(true);
  const [interstitialSeconds, setInterstitialSeconds] = useState("2");
  const [rules, setRules] = useState<LinkRuleInput[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.links.create({
        destination_url: url,
        alias: alias || undefined,
        title: title || undefined,
        tags: parseTags(tags),
        redirect_code: Number(code),
        rules,
        domain,
        // Unchecking sends 0, which is what turns the interstitial off.
        interstitial_seconds: interstitialOn ? Number(interstitialSeconds) : 0,
      });
      setCreated(result);
      toast({ kind: "success", title: t("links.created.title") });
    } catch (err) {
      setError(errorText(t, err, "error.create"));
    } finally {
      setLoading(false);
    }
  }

  function startAnother() {
    setUrl("");
    setAlias("");
    setDomain("");
    setTitle("");
    setTags("");
    setCode("302");
    setInterstitialOn(true);
    setInterstitialSeconds("2");
    setRules([]);
    setError("");
    setCreated(null);
  }

  return (
    <div className="console-page mx-auto max-w-3xl">
      <div className="console-page-header">
        <div className="console-page-heading">
          <p className="console-breadcrumb">{t("shell.workspace")} / {t("links.title")}</p>
          <h1 className="console-page-title">{created ? t("links.created.title") : t("links.form.submit")}</h1>
        </div>
      </div>
      {created ? (
        <section className="console-panel space-y-4 p-4 sm:p-5">
          <div>
            <p className="text-sm text-[var(--muted)]">{t("links.created.body")}</p>
            <p className="mt-3 font-mono text-sm text-[var(--muted)]">/{created.link.alias}</p>
          </div>
          <CopyLinkButton value={created.short_url} />
          <div className="flex flex-wrap gap-3">
            <a href={api.links.previewUrl(created.short_url)} target="_blank" rel="noreferrer" className="btn-secondary">
              {t("links.created.preview")}
            </a>
            <Link href={`/home/links/${created.link.id}/edit`} className="btn-secondary">
              {t("links.created.edit")}
            </Link>
            <button type="button" className="btn-primary" onClick={startAnother}>{t("links.created.new")}</button>
          </div>
        </section>
      ) : (
      <form onSubmit={submit} className="console-panel space-y-4 p-4 sm:p-5">
        <label className="block">
          <span className="field-label">{t("links.form.destination")}</span>
          <input required type="url" className="field-control" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{t("links.form.alias")}</span>
          <input className="field-control" placeholder={t("links.form.aliasPlaceholder")} value={alias} onChange={(e) => setAlias(e.target.value)} />
        </label>
        <LinkDomainPicker value={domain} onChange={setDomain} />
        <label className="block">
          <span className="field-label">{t("links.form.title")}</span>
          <input className="field-control" maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{t("links.form.tags")}</span>
          <input className="field-control" placeholder={t("links.form.tagsPlaceholder")} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">{t("links.form.redirectCode")}</span>
          <select className="field-control" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="302">{t("links.redirect.temporary")}</option>
            <option value="301">{t("links.redirect.permanent")}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={interstitialOn} onChange={(e) => setInterstitialOn(e.target.checked)} />
            {t("links.form.interstitial")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="number"
              className="field-control w-20"
              min={1}
              max={60}
              required={interstitialOn}
              disabled={!interstitialOn}
              value={interstitialSeconds}
              onChange={(e) => setInterstitialSeconds(e.target.value)}
            />
            {t("links.form.interstitialUnit")}
          </label>
        </div>
        {error && <p className="console-alert" role="alert">{error}</p>}
        <LinkRulesEditor rules={rules} onChange={setRules} />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>{t("common.cancel")}</button>
          <button className="btn-primary" disabled={loading}>{loading ? t("links.form.submitting") : t("links.form.submit")}</button>
        </div>
      </form>
      )}
    </div>
  );
}
