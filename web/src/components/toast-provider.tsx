"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { Icon } from "@/components/icon";
import { addToast, removeToast, type FeedbackToast, type ToastKind } from "@/lib/feedback-queue";

export type ToastOptions = {
  kind: ToastKind;
  title: string;
  description?: string;
  duration?: number;
};

type ToastContextValue = {
  toast: (input: ToastOptions) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION = 4200;

function iconName(kind: ToastKind) {
  if (kind === "success") return "check" as const;
  if (kind === "error") return "close" as const;
  return "info" as const;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);
  const timers = useRef(new Map<string, number>());
  const sequence = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => removeToast(current, id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback((input: ToastOptions) => {
    const id = `toast-${sequence.current++}`;
    const next: FeedbackToast = { id, kind: input.kind, title: input.title, description: input.description };
    setToasts((current) => addToast(current, next));
    if (input.duration !== 0) {
      const timer = window.setTimeout(() => dismiss(id), input.duration ?? DEFAULT_DURATION);
      timers.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="rare-toast-viewport" aria-label={t("common.notifications")}>
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="rare-toast"
              data-kind={item.kind}
              role={item.kind === "error" ? "alert" : "status"}
            >
              <span className="rare-toast-icon" aria-hidden="true"><Icon name={iconName(item.kind)} size={16} /></span>
              <div className="min-w-0">
                <p className="rare-toast-title">{item.title}</p>
                {item.description && <p className="rare-toast-description">{item.description}</p>}
              </div>
              <button type="button" className="rare-toast-dismiss" onClick={() => dismiss(item.id)} aria-label={t("common.close")}>
                <Icon name="close" size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be called inside a ToastProvider");
  return value;
}
