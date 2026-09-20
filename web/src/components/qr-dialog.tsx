"use client";

import { api, LinkRecord } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { RareDialog } from "@/components/ui/rare/dialog";

export function QrDialog({ link, onClose }: { link: LinkRecord | null; onClose: () => void }) {
  const t = useT();
  const imageUrl = link ? api.links.qrUrl(link.id, 320) : "";

  return (
    <RareDialog
      open={Boolean(link)}
      title={t("links.qr")}
      description={link ? `/${link.alias}` : undefined}
      onClose={onClose}
      className="max-w-sm"
    >
      {link && (
        <>
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
        </>
      )}
    </RareDialog>
  );
}
