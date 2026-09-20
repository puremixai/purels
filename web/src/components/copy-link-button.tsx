"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";

type CopyStatus = "idle" | "copied" | "error";

function fallbackCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

export function CopyLinkButton({ value, compact = false }: { value: string; compact?: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        fallbackCopy(value);
      }
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2200);
  }

  const label = status === "copied"
    ? t("links.copied")
    : status === "error"
      ? t("links.copyFailed")
      : t("links.copy");
  const labelClass = status === "copied"
    ? "text-success"
    : status === "error"
      ? "text-danger"
      : "text-[var(--brand)]";

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={`group flex w-full items-center justify-between gap-4 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] text-left transition hover:border-[var(--brand)] hover:bg-[var(--canvas-alt)] ${compact ? "min-h-10 px-3 py-2" : "min-h-14 px-4 py-3"}`}
    >
      <span className="min-w-0 flex-1 break-all font-mono text-sm text-[var(--ink)]">{value}</span>
      <span className={`shrink-0 text-xs font-semibold ${labelClass}`}>{label}</span>
    </button>
  );
}
