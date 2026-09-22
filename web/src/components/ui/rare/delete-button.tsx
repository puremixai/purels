"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export type DeleteButtonProps = {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Shown in place of the buttons' labels when the action failed. */
  errorLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function DeleteButton({
  onConfirm,
  onCancel,
  label = "Delete",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  errorLabel = "Failed",
  disabled = false,
  className,
}: DeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setFailed(false);
    onCancel?.();
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // The confirm button appears where the trigger was, so a keyboard user
      // would otherwise have to press Tab again to reach the action they chose.
      confirmRef.current?.focus();
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // The trigger is mounted again by now. Without this, dismissing the
    // confirmation deletes the focused element and the keyboard loses its place.
    triggerRef.current?.focus();
  }, [open]);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // A delete that failed must not look like one that was cancelled: the
      // confirmation stays armed and says why, so retrying is one click.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button ref={triggerRef} type="button" className={cn("rare-delete-trigger", className)} disabled={disabled} onClick={() => setOpen(true)}>
        <Icon name="trash" size={16} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <span className={cn("inline-flex flex-col items-end gap-1", className)}>
      <motion.span initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} aria-busy={busy} className="rare-delete-confirm">
        <span className="sr-only">{label}</span>
        <button ref={confirmRef} type="button" className="rare-delete-confirm-button" disabled={busy} onClick={confirm}>{confirmLabel}</button>
        <button type="button" className="rare-delete-cancel-button" disabled={busy} onClick={close}>{cancelLabel}</button>
      </motion.span>
      {failed && <span className="text-2xs font-semibold text-danger" role="alert">{errorLabel}</span>}
    </span>
  );
}
