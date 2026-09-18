"use client";

import { LinkRuleInput } from "@/lib/api-client";

/** Matches the API's cap, so the button disables before the request would fail. */
const MAX_RULES = 10;

const MATCH_TYPES = [
  { value: "ua_contains", label: "UA 包含" },
  { value: "device", label: "设备类型" },
];

/** The vocabulary DeviceClass can return, which is what a device rule matches. */
const DEVICES = [
  { value: "mobile", label: "手机" },
  { value: "tablet", label: "平板" },
  { value: "desktop", label: "桌面" },
  { value: "bot", label: "爬虫" },
  { value: "unknown", label: "未知" },
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
  function update(index: number, patch: Partial<LinkRuleInput>) {
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="field-label mb-0">分流规则</span>
        <button
          type="button"
          className="btn-secondary"
          disabled={rules.length >= MAX_RULES}
          onClick={() => onChange([...rules, emptyRule()])}
        >
          添加规则
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">无</p>
      ) : (
        rules.map((rule, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-[var(--line)] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">匹配方式</span>
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
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="field-label">匹配值</span>
                {rule.match_type === "device" ? (
                  <select
                    className="field-control"
                    value={rule.match_value}
                    onChange={(event) => update(index, { match_value: event.target.value })}
                  >
                    {DEVICES.map((device) => (
                      <option key={device.value} value={device.value}>
                        {device.label}
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
              <span className="field-label">目标 URL</span>
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
                <span className="field-label">跳转状态码</span>
                <select
                  className="field-control"
                  value={String(rule.redirect_code)}
                  onChange={(event) => update(index, { redirect_code: Number(event.target.value) })}
                >
                  <option value="0">跟随链接</option>
                  <option value="302">302 临时跳转</option>
                  <option value="301">301 永久跳转</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-danger"
                onClick={() => onChange(rules.filter((_, position) => position !== index))}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
