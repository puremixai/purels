"use client";

import { useCallback, useEffect, useState } from "react";
import { allScopes, api, ApiError, roleLabels, RoleRecord } from "@/lib/api-client";

type Draft = { scopes: string[]; unrestricted: boolean };

function toDraft(role: RoleRecord): Draft {
  return { scopes: [...role.scopes].sort(), unrestricted: role.unrestricted };
}

function sameDraft(a: Draft, b: Draft) {
  return a.unrestricted === b.unrestricted && a.scopes.length === b.scopes.length && a.scopes.every((scope, index) => scope === b.scopes[index]);
}

export default function RolesPage() {
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
      setError(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setNotice(`已保存 ${roleLabels[name] || name}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted)]">工作台 / 角色权限</p>
        <h1 className="mt-1 text-2xl font-bold">角色权限</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{notice}</p>}

      {loading && !roles.length && <p className="text-sm text-[var(--muted)]">正在加载...</p>}

      {roles.map((role) => {
        const draft = drafts[role.name] || toDraft(role);
        const dirty = !sameDraft(draft, toDraft(role));
        return (
          <section className="panel space-y-4 p-6" key={role.name}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">{roleLabels[role.name] || role.name}</h2>
              <button className="btn-primary" disabled={!dirty || busy === role.name} onClick={() => save(role.name)}>
                {busy === role.name ? "正在保存..." : "保存"}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {allScopes.map((scope) => (
                <label className="flex items-center gap-2 text-sm" key={scope.value}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.scopes.includes(scope.value)}
                    onChange={() => toggleScope(role.name, scope.value)}
                  />
                  {scope.label}
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
              管理全部链接
            </label>
          </section>
        );
      })}
    </div>
  );
}
