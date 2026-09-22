"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";

const units = [86400, 3600, 60, 1] as const;
const unitKeys = ["settings.form.days", "settings.form.hours", "settings.form.minutes", "settings.form.seconds"] as const;

/** Preserve second precision for existing settings, even when changing units. */
export function DurationField({ id, value, min, max, onChange }: {
  id: string; value: string; min: number; max: number; onChange: (value: string) => void;
}) {
  const t = useT();
  const [unit, setUnit] = useState<number>(() => units.find(u => Number(value) >= u && Number(value) % u === 0) ?? 1);
  return <div className="settings-duration">
    <input id={id} className="field-control" type="number" required min={min / unit} max={max / unit} step="any"
      value={value === "" ? "" : Number(value) / unit}
      onChange={event => onChange(event.target.value === "" ? "" : String(Math.round(Number(event.target.value) * unit)))} />
    <select className="field-control" aria-label={t("settings.form.unit")} value={unit} onChange={event => setUnit(Number(event.target.value))}>
      {units.map((u, index) => <option key={u} value={u}>{t(unitKeys[index])}</option>)}
    </select>
  </div>;
}
