"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import { jsonForScript, parseAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics-config";

/**
 * The ids the injected elements carry.
 *
 * They are fixed constants rather than anything derived from the stored values,
 * and the browser smoke suite asserts on them, so they are part of this
 * component's contract.
 */
const SCRIPT_IDS = {
  ga4: "purels-analytics-ga4",
  gtm: "purels-analytics-gtm",
  matomo: "purels-analytics-matomo",
} as const;

/**
 * AnalyticsInjector renders the configured tracking snippets.
 *
 * It is mounted by app/home/layout.tsx, and that placement is the whole of the
 * scope: /login and /register are siblings of /home rather than children of it,
 * so nothing rendered here can reach them. The public short link redirect is
 * served by the Go API and never touches Next.js at all.
 *
 * Nothing is rendered until the configuration has been read, and a failure to
 * read it renders nothing either — tracking must never be able to break the
 * console.
 */
export function AnalyticsInjector() {
  const [config, setConfig] = useState<AnalyticsConfig | null>(null);

  // A layout is not remounted between its child routes, so this runs once per
  // entry into the console and needs no cache. The cancelled flag covers React
  // StrictMode's double-invoke in development.
  useEffect(() => {
    let cancelled = false;
    api.analytics
      .get()
      .then((settings) => {
        if (!cancelled) setConfig(parseAnalyticsConfig(settings));
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (config === null) return null;

  return (
    <>
      {config.ga4MeasurementId !== "" && (
        <Script
          id={SCRIPT_IDS.ga4}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: ga4Snippet(config.ga4MeasurementId) }}
        />
      )}
      {config.gtmContainerId !== "" && (
        <Script
          id={SCRIPT_IDS.gtm}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: gtmSnippet(config.gtmContainerId) }}
        />
      )}
      {config.matomoUrl !== "" && (
        <Script
          id={SCRIPT_IDS.matomo}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: matomoSnippet(config.matomoUrl, config.matomoSiteId) }}
        />
      )}
      <RoutePageviews config={config} />
    </>
  );
}

/**
 * RoutePageviews reports the client-side navigations the snippets cannot see.
 *
 * The console is a single page application, so only the first pageview happens
 * on a real load. Each snippet already sends that first one — gtag's `config`
 * call, Matomo's own `trackPageView`, and for GTM the container's All Pages
 * trigger — so this component deliberately skips its first run and reports only
 * changes. Anything else would double-count the landing page.
 */
function RoutePageviews({ config }: { config: AnalyticsConfig }) {
  const pathname = usePathname();
  // Seeded with the mount pathname, which is what makes the first effect run a
  // no-op. A ref rather than state: changing it must not cause a render.
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    const path = window.location.pathname + window.location.search;

    if (config.ga4MeasurementId !== "" && typeof window.gtag === "function") {
      window.gtag("event", "page_view", { page_path: path });
    }
    if (config.matomoUrl !== "" && Array.isArray(window._paq)) {
      window._paq.push(["setCustomUrl", window.location.href]);
      window._paq.push(["setDocumentTitle", document.title]);
      window._paq.push(["trackPageView"]);
    }
    // GTM is absent on purpose: its History Change trigger already fires on
    // pushState, so pushing here as well would count every navigation twice.
    // The container has to have that trigger configured; the All Pages trigger
    // alone covers only the first load.
  }, [pathname, config]);

  return null;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    _paq?: unknown[][];
  }
}

/**
 * GA4. The `config` call sends the landing pageview, so it is not repeated here.
 */
function ga4Snippet(measurementId: string): string {
  return (
    "window.dataLayer = window.dataLayer || [];" +
    "function gtag(){window.dataLayer.push(arguments);}" +
    "window.gtag = gtag;" +
    "gtag('js', new Date());" +
    `gtag('config', ${jsonForScript(measurementId)});` +
    "(function(){var s=document.createElement('script');s.async=true;" +
    `s.src='https://www.googletagmanager.com/gtag/js?id='+${jsonForScript(measurementId)};` +
    "document.head.appendChild(s);})();"
  );
}

/** GTM. The container's own triggers decide what is sent. */
function gtmSnippet(containerId: string): string {
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
    "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!=='dataLayer'?'&l='+l:'';" +
    "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" +
    "f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer'," +
    jsonForScript(containerId) +
    ");"
  );
}

/** Matomo. The `trackPageView` here sends the landing pageview. */
function matomoSnippet(baseUrl: string, siteId: string): string {
  return (
    "var _paq = window._paq = window._paq || [];" +
    `_paq.push(['setTrackerUrl', ${jsonForScript(`${baseUrl}/matomo.php`)}]);` +
    `_paq.push(['setSiteId', ${jsonForScript(siteId)}]);` +
    "_paq.push(['trackPageView']);" +
    "_paq.push(['enableLinkTracking']);" +
    "(function(){var d=document,g=d.createElement('script'),s=d.getElementsByTagName('script')[0];" +
    `g.async=true;g.src=${jsonForScript(`${baseUrl}/matomo.js`)};s.parentNode.insertBefore(g,s);})();`
  );
}
