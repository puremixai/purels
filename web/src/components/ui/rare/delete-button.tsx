"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export type DeleteButtonProps = {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function DeleteButton({
  onConfirm,
  onCancel,
  label = "Delete",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  disabled = false,
  className,
}: DeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        onCancel?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={cn("rare-delete-trigger", className)} disabled={disabled} onClick={() => setOpen(true)} aria-label={label}>
        <Icon name="trash" size={16} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <motion.span initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={cn("rare-delete-confirm", className)}>
      <span className="sr-only">{label}</span>
      <button type="button" className="rare-delete-confirm-button" disabled={busy} onClick={confirm}>{confirmLabel}</button>
      <button type="button" className="rare-delete-cancel-button" disabled={busy} onClick={() => { setOpen(false); onCancel?.(); }}>{cancelLabel}</button>
    </motion.span>
  );
}
