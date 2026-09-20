"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { api, LinkRuleInput } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";
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

export default function NewLinkPage() {
  const router = useRouter();
  const t = useT();
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
        domain,
        // Unchecking sends 0, which is what turns the interstitial off.
        interstitial_seconds: interstitialOn ? Number(interstitialSeconds) : 0,
      });
      router.push("/home/links");
    } catch (err) {
      setError(errorText(t, err, "error.create"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("links.title")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("links.form.submit")}</h1>
      </div>
      <form onSubmit={submit} className="panel space-y-5 p-6">
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
        {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <LinkRulesEditor rules={rules} onChange={setRules} />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>{t("common.cancel")}</button>
          <button className="btn-primary" disabled={loading}>{loading ? t("links.form.submitting") : t("links.form.submit")}</button>
        </div>
      </form>
    </div>
  );
}
