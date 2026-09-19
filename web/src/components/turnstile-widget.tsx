"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n-provider";

/** Keep this URL fixed: provider verification is not operator-controlled. */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileAPI = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | number;
  reset?: (widgetId?: string | number) => void;
  remove?: (widgetId: string | number) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

export type TurnstileWidgetProps = {
  siteKey: string;
  onTokenChange: (token: string) => void;
  onError?: (message: string) => void;
  resetSignal?: number;
};

/**
 * Explicitly renders one Turnstile widget and exposes its token through a
 * callback. Registration owns submission, so this component never adds form
 * controls or hidden fields of its own.
 */
export function TurnstileWidget({ siteKey, onTokenChange, onError, resetSignal = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | number | null>(null);
  const tokenChangeRef = useRef(onTokenChange);
  const errorRef = useRef(onError);
  const t = useT();
  // The translator is held in a ref for the same reason the callbacks are: the
  // effect that renders the widget must not re-run when the language changes, or
  // switching language would tear the widget down and throw away a challenge the
  // visitor had already solved.
  const translateRef = useRef(t);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    tokenChangeRef.current = onTokenChange;
    errorRef.current = onError;
    translateRef.current = t;
  }, [onTokenChange, onError, t]);

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) return;

    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => tokenChangeRef.current(token),
      "expired-callback": () => tokenChangeRef.current(""),
      "error-callback": () => {
        tokenChangeRef.current("");
        errorRef.current?.(translateRef.current("turnstile.loadFailed"));
      },
    });
    widgetIdRef.current = widgetId;

    return () => {
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      tokenChangeRef.current("");
    };
  }, [scriptReady, siteKey]);

  useEffect(() => {
    if (resetSignal === 0 || widgetIdRef.current === null) return;
    window.turnstile?.reset?.(widgetIdRef.current);
    tokenChangeRef.current("");
  }, [resetSignal]);

  return (
    <>
      <Script
        id="cloudflare-turnstile"
        src={TURNSTILE_SCRIPT_URL}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} />
    </>
  );
}
