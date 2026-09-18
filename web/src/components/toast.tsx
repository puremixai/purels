"use client";

import { useEffect } from "react";
import { Icon } from "./icon";

export function Toast({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error"; onClose?: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onClose?.(), 4200);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`} role="status">
      <Icon name={kind === "error" ? "close" : "check"} size={17} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button aria-label="关闭提示" className="opacity-60 hover:opacity-100" onClick={onClose}><Icon name="close" size={15} /></button>
    </div>
  );
}
