"use client";
import { useCallback, useEffect, useRef } from "react";
import { useT } from "@/components/i18n-provider";
import type { T } from "@/lib/i18n";

/** Changing display language must not reload and overwrite an unsaved form. */
export function useSettingsTranslator(): T {
  const t = useT();
  const current = useRef(t);
  useEffect(() => { current.current = t; }, [t]);
  return useCallback((key, params) => current.current(key, params), []);
}
