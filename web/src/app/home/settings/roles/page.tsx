"use client";

import { useCallback, useEffect, useState } from "react";
import { api, RoleRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { errorText, hasMessage, type MessageKey, type T } from "@/lib/i18n";
import { RareStatus } from "@/components/rare/rare-status";
import { SettingsAccess } from "@/components/settings/settings-access";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-page";

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

const SCOPE_GROUPS: ReadonlyArray<{ labelKey: MessageKey; scopes: readonly string[] }> = [
  { labelKey: "settings.roles.group.links", scopes: ["links:read", "links:write"] },
  { labelKey: "settings.roles.group.workspace", scopes: ["stats:read", "audit:read"] },
  { labelKey: "settings.roles.group.access", scopes: ["tokens:manage", "users:manage", "roles:manage", "oidc:manage"] },
  { labelKey: "settings.roles.group.service", scopes: ["analytics:manage", "captcha:manage", "settings:manage"] },
];

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
  const { toast } = useToast();
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
      toast({ kind: "success", title: t("settings.roles.saved", { name: roleLabel(t, name) }) });
    } catch (e) {
      setError(errorText(t, e, "error.save"));
    } finally {
      setBusy("");
    }
  }

  return (
    <SettingsPage
      group={t("nav.group.access")}
      title={t("settings.roles.title")}
      description={t("settings.roles.description")}
    >
      <SettingsAccess>{scopes => <SettingsTabs group="access" scopes={scopes} />}</SettingsAccess>

      {error && <p className="console-alert" role="alert">{error}</p>}
      {notice && <p className="console-notice" role="status">{notice}</p>}

      {loading && !roles.length && <span className="console-skeleton w-32" role="status" aria-label={t("common.loading")} />}

      {roles.map((role) => {
        const draft = drafts[role.name] || toDraft(role);
        const dirty = !sameDraft(draft, toDraft(role));
        return (
          <SettingsSection
            key={role.name}
            title={roleLabel(t, role.name)}
            status={<RareStatus tone={dirty ? "warning" : "neutral"}>{dirty ? t("settings.unsaved") : t("settings.synced")}</RareStatus>}
            actions={(
              <button className="btn-primary" disabled={!dirty || busy === role.name} onClick={() => save(role.name)}>
                {busy === role.name ? t("common.saving") : t("common.save")}
              </button>
            )}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {SCOPE_GROUPS.map((group) => (
                <fieldset className="settings-permission-group" key={group.labelKey}>
                  <legend>{t(group.labelKey)}</legend>
                  <div className="mt-2 grid gap-2">
                    {group.scopes.filter((scope) => SCOPES.includes(scope as typeof SCOPES[number])).map((scope) => (
                      <label className="flex items-start gap-2 text-sm" key={scope}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={draft.scopes.includes(scope)}
                          onChange={() => toggleScope(role.name, scope)}
                        />
                        <span>{scopeLabel(t, scope)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <label className="mt-4 flex items-start gap-2 border-t border-[var(--line)] pt-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={draft.unrestricted}
                onChange={() => edit(role.name, (current) => ({ ...current, unrestricted: !current.unrestricted }))}
              />
              <span>
                <span className="block font-medium">{t("settings.roles.unrestricted")}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{t("settings.roles.unrestrictedDescription")}</span>
              </span>
            </label>
          </SettingsSection>
        );
      })}
    </SettingsPage>
  );
}
