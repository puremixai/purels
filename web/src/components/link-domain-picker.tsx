"use client";

import { useEffect, useState } from "react";
import { api, AppConfig } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";

/**
 * Picks which configured short domain a link is filed under. It renders
 * nothing when the deployment has only the default domain, so a single-domain
 * install sees no new control.
 */
export function LinkDomainPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch(() => {
        // The picker is an extra; failing to load the list must not stop the
        // form from submitting on the default domain.
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config || config.short_domains.length === 0) {
    return null;
  }

  return (
    <label className="block">
      <span className="field-label">{t("links.form.domain")}</span>
      <select className="field-control" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{config.default_domain}</option>
        {config.short_domains.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>
    </label>
  );
}
