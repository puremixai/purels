"use client";

import { useEffect } from "react";
import { api, LinkRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";

export function QrDialog({ link, onClose }: { link: LinkRecord | null; onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    if (!link) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [link, onClose]);

  if (!link) return null;
  const imageUrl = api.links.qrUrl(link.id, 320);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-5" onClick={onClose}>
      <div className="panel w-full max-w-sm p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold">{t("links.qr")}</h2>
            <p className="truncate text-sm text-[var(--muted)]">/{link.alias}</p>
          </div>
          <button
            className="rounded p-1 text-faint hover:bg-canvas"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={t("qr.alt", { alias: link.alias })}
          width={320}
          height={320}
          className="mx-auto rounded-lg border border-[var(--line)] bg-surface"
        />
        <a href={imageUrl} download={`${link.alias}.png`} className="btn-secondary mt-4 block w-full text-center">
          {t("qr.download")}
        </a>
      </div>
    </div>
  );
}
