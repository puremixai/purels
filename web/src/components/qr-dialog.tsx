"use client";

import { useEffect } from "react";
import { api, LinkRecord } from "@/lib/api-client";

export function QrDialog({ link, onClose }: { link: LinkRecord | null; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-5" onClick={onClose}>
      <div className="panel w-full max-w-sm p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold">二维码</h2>
            <p className="truncate text-sm text-[var(--muted)]">/{link.alias}</p>
          </div>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`/${link.alias} 的二维码`}
          width={320}
          height={320}
          className="mx-auto rounded-lg border border-[var(--line)] bg-white"
        />
        <a href={imageUrl} download={`${link.alias}.png`} className="btn-secondary mt-4 block w-full text-center">
          下载 PNG
        </a>
      </div>
    </div>
  );
}
