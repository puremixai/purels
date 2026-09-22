import type { RuntimeSettingsInput } from "./api-client";

// These groups are the only fields each save operation may change.
export const runtimeGroups = {
  creation: ["alias_mode", "unique_urls", "max_links_per_user", "short_domains"],
  redirects: ["forward_query", "fallback_url", "destination_denylist"],
  maintenance: ["health_check_enabled", "health_check_interval_seconds", "auto_prune_expired", "prune_grace_seconds"],
  registration: ["registration_enabled"],
  traffic: ["rate_limit_enabled", "rate_limit_login", "rate_limit_register", "rate_limit_2fa", "rate_limit_oidc", "rate_limit_api", "rate_limit_redirect"],
  statistics: ["count_bots"],
} as const satisfies Record<string, readonly (keyof RuntimeSettingsInput)[]>;

export type RuntimeGroup = keyof typeof runtimeGroups;
export type RuntimeDraft = Partial<Record<keyof RuntimeSettingsInput, string | boolean>>;

export function runtimeDraft(settings: RuntimeSettingsInput, group: RuntimeGroup): RuntimeDraft {
  return Object.fromEntries(runtimeGroups[group].map(key => {
    const value = settings[key];
    return [key, typeof value === "boolean" ? value : Array.isArray(value) ? value.join("\n") : String(value)];
  }));
}

export function runtimeChanges(saved: RuntimeSettingsInput, draft: RuntimeDraft, group: RuntimeGroup): Partial<RuntimeSettingsInput> {
  const changes: Record<string, unknown> = {};
  for (const key of runtimeGroups[group]) {
    // Disabled dependent controls retain their persisted values.
    if (key === "health_check_interval_seconds" && draft.health_check_enabled === false) continue;
    if (key === "prune_grace_seconds" && draft.auto_prune_expired === false) continue;
    if (key.startsWith("rate_limit_") && key !== "rate_limit_enabled" && draft.rate_limit_enabled === false) continue;
    const raw = draft[key];
    if (raw === undefined) continue;
    const old = saved[key];
    const value = Array.isArray(old)
      ? String(raw).split(/[\n,]/).map(item => item.trim()).filter(Boolean)
      : typeof old === "number" ? Number(raw) : raw;
    if (typeof old === "number" && (raw === "" || !Number.isSafeInteger(value))) throw new Error(key);
    if (JSON.stringify(value) !== JSON.stringify(old)) changes[key] = value;
  }
  return changes as Partial<RuntimeSettingsInput>;
}
