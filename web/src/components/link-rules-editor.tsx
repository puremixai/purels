"use client";

import { useT } from "@/components/i18n-provider";
import { LinkRuleInput } from "@/lib/api-client";
import type { MessageKey } from "@/lib/i18n";

/** Matches the API's cap, so the button disables before the request would fail. */
const MAX_RULES = 10;

const MATCH_TYPES: Array<{ value: string; labelKey: MessageKey }> = [
  { value: "ua_contains", labelKey: "rules.matchUa" },
  { value: "device", labelKey: "rules.matchDevice" },
];

/** The vocabulary DeviceClass can return, which is what a device rule matches. */
const DEVICES: Array<{ value: string; labelKey: MessageKey }> = [
  { value: "mobile", labelKey: "deviceRule.mobile" },
  { value: "tablet", labelKey: "deviceRule.tablet" },
  { value: "desktop", labelKey: "deviceRule.desktop" },
  { value: "bot", labelKey: "deviceRule.bot" },
  { value: "unknown", labelKey: "deviceRule.unknown" },
];

export function emptyRule(): LinkRuleInput {
  return { match_type: "ua_contains", match_value: "", destination_url: "", redirect_code: 0 };
}

/**
 * Edits a link's divert rules as an ordered list: the order on screen is the
 * match order, and the first rule that fires wins.
 */
export function LinkRulesEditor({
  rules,
  onChange,
}: {
  rules: LinkRuleInput[];
  onChange: (rules: LinkRuleInput[]) => void;
}) {
  const t = useT();

  function update(index: number, patch: Partial<LinkRuleInput>) {
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="field-label mb-0">{t("rules.title")}</span>
        <button
          type="button"
          className="btn-secondary"
          disabled={rules.length >= MAX_RULES}
          onClick={() => onChange([...rules, emptyRule()])}
        >
          {t("rules.add")}
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("rules.none")}</p>
      ) : (
        rules.map((rule, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-[var(--line)] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">{t("rules.matchType")}</span>
                <select
                  className="field-control"
                  value={rule.match_type}
                  onChange={(event) =>
                    update(index, {
                      match_type: event.target.value,
                      // The two types share no vocabulary, so a value carried
                      // over from the other one would be rejected on save.
                      match_value: event.target.value === "device" ? "mobile" : "",
                    })
                  }
                >
                  {MATCH_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {t(type.labelKey)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="field-label">{t("rules.matchValue")}</span>
                {rule.match_type === "device" ? (
                  <select
                    className="field-control"
                    value={rule.match_value}
                    onChange={(event) => update(index, { match_value: event.target.value })}
                  >
                    {DEVICES.map((device) => (
                      <option key={device.value} value={device.value}>
                        {t(device.labelKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field-control"
                    maxLength={255}
                    placeholder="iPhone"
                    value={rule.match_value}
                    onChange={(event) => update(index, { match_value: event.target.value })}
                  />
                )}
              </label>
            </div>

            <label className="block">
              <span className="field-label">{t("links.form.destination")}</span>
              <input
                type="url"
                className="field-control"
                placeholder="https://example.com"
                value={rule.destination_url}
                onChange={(event) => update(index, { destination_url: event.target.value })}
              />
            </label>

            <div className="flex items-end gap-3">
              <label className="block flex-1">
                <span className="field-label">{t("links.form.redirectCode")}</span>
                <select
                  className="field-control"
                  value={String(rule.redirect_code)}
                  onChange={(event) => update(index, { redirect_code: Number(event.target.value) })}
                >
                  <option value="0">{t("links.redirect.follow")}</option>
                  <option value="302">{t("links.redirect.temporary")}</option>
                  <option value="301">{t("links.redirect.permanent")}</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-danger"
                onClick={() => onChange(rules.filter((_, position) => position !== index))}
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
