"use client";

import { useCallback, useEffect, useState } from "react";
import { api, RoleRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { errorText, hasMessage, type T } from "@/lib/i18n";

type Draft = { scopes: string[]; unrestricted: boolean };

// The permissions a role can grant, in the order the form lists them. The label
// is a key resolved at render, because the list is built before a locale exists.
const SCOPES = [
  "links:read",
  "links:write",
  "stats:read",
  "audit:read",
  "tokens:manage",
  "users:manage",
  "roles:manage",
  "oidc:manage",
  "analytics:manage",
  "captcha:manage",
  "settings:manage",
] as const;

function scopeLabel(t: T, scope: string) {
  const key = `scope.${scope}`;
  return hasMessage(key) ? t(key) : scope;
}

function roleLabel(t: T, name: string) {
  const key = `role.${name}`;
  return hasMessage(key) ? t(key) : name;
}

function toDraft(role: RoleRecord): Draft {
  return { scopes: [...role.scopes].sort(), unrestricted: role.unrestricted };
}

function sameDraft(a: Draft, b: Draft) {
  return a.unrestricted === b.unrestricted && a.scopes.length === b.scopes.length && a.scopes.every((scope, index) => scope === b.scopes[index]);
}

export default function RolesPage() {
  const t = useT();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.roles.list();
      setRoles(list);
      setDrafts(Object.fromEntries(list.map((role) => [role.name, toDraft(role)])));
      setError("");
    } catch (e) {
      setError(errorText(t, e, "error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function edit(name: string, change: (draft: Draft) => Draft) {
    setNotice("");
    setDrafts((current) => ({ ...current, [name]: change(current[name]) }));
  }

  function toggleScope(name: string, scope: string) {
    edit(name, (draft) => ({
      ...draft,
      scopes: draft.scopes.includes(scope)
        ? draft.scopes.filter((value) => value !== scope)
        : [...draft.scopes, scope].sort(),
    }));
  }

  async function save(name: string) {
    const draft = drafts[name];
    if (!draft) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await api.roles.update(name, draft);
      await load();
      setNotice(t("settings.roles.saved", { name: roleLabel(t, name) }));
    } catch (e) {
      setError(errorText(t, e, "error.save"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("shell.workspace")} / {t("settings.roles.title")}</p>
        <h1 className="mt-1 text-2xl font-bold">{t("settings.roles.title")}</h1>
      </div>

      {error && <p className="rounded-lg bg-danger-tint px-4 py-3 text-danger">{error}</p>}
      {notice && <p className="rounded-lg bg-success-tint px-4 py-3 text-success">{notice}</p>}

      {loading && !roles.length && <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>}

      {roles.map((role) => {
        const draft = drafts[role.name] || toDraft(role);
        const dirty = !sameDraft(draft, toDraft(role));
        return (
          <section className="panel space-y-4 p-6" key={role.name}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">{roleLabel(t, role.name)}</h2>
              <button className="btn-primary" disabled={!dirty || busy === role.name} onClick={() => save(role.name)}>
                {busy === role.name ? t("common.saving") : t("common.save")}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPES.map((scope) => (
                <label className="flex items-center gap-2 text-sm" key={scope}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.scopes.includes(scope)}
                    onChange={() => toggleScope(role.name, scope)}
                  />
                  {scopeLabel(t, scope)}
                </label>
              ))}
            </div>

            <label className="flex items-center gap-2 border-t border-[var(--line)] pt-4 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.unrestricted}
                onChange={() => edit(role.name, (current) => ({ ...current, unrestricted: !current.unrestricted }))}
              />
              {t("settings.roles.unrestricted")}
            </label>
          </section>
        );
      })}
    </div>
  );
}
