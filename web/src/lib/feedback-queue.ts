export type ToastKind = "success" | "error" | "info";

export type FeedbackToast = {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
};

export function addToast(state: FeedbackToast[], toast: FeedbackToast, limit = 3): FeedbackToast[] {
  const next = [toast, ...state.filter((item) => item.id !== toast.id)];
  return next.slice(0, Math.max(1, limit));
}

export function removeToast(state: FeedbackToast[], id: string): FeedbackToast[] {
  return state.filter((item) => item.id !== id);
}
