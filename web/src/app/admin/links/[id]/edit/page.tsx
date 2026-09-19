"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useT } from "@/components/i18n-provider";
import { api, LinkRecord, LinkRuleInput } from "@/lib/api-client";
import { errorText } from "@/lib/i18n";
import { LinkDomainPicker } from "@/components/link-domain-picker";
import { LinkRulesEditor } from "@/components/link-rules-editor";
import { parseTags } from "@/lib/tags";

function formatTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { hour12: false });
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
  const t = useT();
  const locale = useLocale();
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
        if (!cancelled) setError(errorText(t, e, "error.load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // t is stable per locale, so this refetches only when the language changes.
  }, [id, t]);

  async function checkNow() {
    setChecking(true);
    setError("");
    try {
      const result = await api.links.check(id);
      setLink((current) =>
        current ? { ...current, last_checked_at: result.checked_at, last_status_code: result.status_code } : current,
      );
      // A destination that could not be reached at all is reported here rather
      // than stored: the recorded status code is 0. The probe's own message is
      // not translated — it names what the network did.
      if (result.error) setError(result.error);
    } catch (e) {
      setError(errorText(t, e, "error.check"));
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
      setError(errorText(t, e, "error.save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("links.title")} / {t("links.edit.breadcrumbTail")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("links.edit.title")}</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      {loading ? (
        <p className="panel p-6 text-sm text-[var(--muted)]">{t("links.edit.loading")}</p>
      ) : link ? (
        <div className="space-y-6">
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm text-[var(--muted)]">
              {link.last_checked_at
                ? <>
                    {t("links.edit.lastChecked", { time: formatTime(link.last_checked_at, locale) })}
                    {link.last_status_code ? ` · ${link.last_status_code}` : ` · ${t("links.edit.checkUnreachable")}`}
                  </>
                : t("links.edit.neverChecked")}
            </span>
            <button type="button" className="btn-secondary" disabled={checking} onClick={checkNow}>
              {checking ? t("links.edit.checking") : t("links.edit.checkNow")}
            </button>
          </div>

          <form onSubmit={submit} className="panel space-y-5 p-6">
          <div>
            <span className="field-label">{t("links.table.short")}</span>
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
                  {t("links.edit.preview")}
                </a>
              )}
            </p>
          </div>

          <LinkDomainPicker value={domain} onChange={setDomain} />

          <label className="block">
            <span className="field-label">{t("links.form.destination")}</span>
            <input required type="url" className="field-control" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">{t("links.form.title")}</span>
            <input className="field-control" maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">{t("links.form.tags")}</span>
            <input className="field-control" placeholder={t("links.form.tagsPlaceholder")} value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>

          <label className="block">
            <span className="field-label">{t("links.form.redirectCode")}</span>
            <select className="field-control" value={code} onChange={(event) => setCode(event.target.value)}>
              <option value="302">{t("links.redirect.temporary")}</option>
              <option value="301">{t("links.redirect.permanent")}</option>
            </select>
          </label>

          <label className="block">
            <span className="field-label">{t("links.edit.status")}</span>
            <select className="field-control" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">{t("links.edit.statusActive")}</option>
              <option value="disabled">{t("links.edit.statusDisabled")}</option>
            </select>
          </label>

          <label className="block">
            <span className="field-label">{t("links.edit.expires")}</span>
            <input type="date" className="field-control" value={expires} onChange={(event) => setExpires(event.target.value)} />
          </label>

          <LinkRulesEditor rules={rules} onChange={setRules} />

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => router.back()}>{t("common.cancel")}</button>
            <button className="btn-primary" disabled={saving}>{saving ? t("links.form.saving") : t("links.form.save")}</button>
          </div>
          </form>
        </div>
      ) : (
        <p className="panel p-6 text-sm text-[var(--muted)]">{t("links.edit.notFound")}</p>
      )}
    </div>
  );
}
