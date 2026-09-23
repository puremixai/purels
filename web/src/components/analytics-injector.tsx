"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { jsonForScript, type AnalyticsConfig } from "@/lib/analytics-config";

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
  googleTag: "purels-analytics-google-tag",
  matomo: "purels-analytics-matomo",
  clarity: "purels-analytics-clarity",
} as const;

/**
 * AnalyticsInjector renders the configured tracking snippets.
 *
 * It is mounted by app/layout.tsx, so it covers every page this console serves:
 * the landing page, sign-in, registration and the console itself. The short
 * link redirect is served by the Go API and never touches Next.js — but the
 * interstitial and preview pages it renders do carry the same trackers, built
 * by internal/http/handler/trackers.go from the same configuration.
 *
 * The configuration arrives as a prop rather than from a fetch here: the root
 * layout reads it on the server, so the snippets are in the HTML the visitor is
 * served instead of arriving after hydration, and one cached read serves every
 * render. A null config — nothing configured, an unreachable API, or a stored
 * value that fails validation — renders nothing at all.
 *
 * The snippets below mirror internal/http/handler/trackers.go. Go cannot import
 * TypeScript and the reverse is equally true, so the two are kept in step by
 * hand; a change to one has to be made in the other.
 */
export function AnalyticsInjector({ config }: { config: AnalyticsConfig | null }) {
  if (config === null) return null;

  return (
    <>
      {config.ga4MeasurementId !== "" && (
        <Script
          id={SCRIPT_IDS.ga4}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: gtagSnippet(config.ga4MeasurementId) }}
        />
      )}
      {config.gtmContainerId !== "" && (
        <Script
          id={SCRIPT_IDS.gtm}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: gtmSnippet(config.gtmContainerId) }}
        />
      )}
      {/* A Google tag is a gtag.js load like GA4, not a container: the two are
          separate fields precisely because gtm.js cannot serve a GT- id. */}
      {config.googleTagId !== "" && (
        <Script
          id={SCRIPT_IDS.googleTag}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: gtagSnippet(config.googleTagId) }}
        />
      )}
      {config.matomoUrl !== "" && (
        <Script
          id={SCRIPT_IDS.matomo}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: matomoSnippet(config.matomoUrl, config.matomoSiteId) }}
        />
      )}
      {config.clarityProjectId !== "" && (
        <Script
          id={SCRIPT_IDS.clarity}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: claritySnippet(config.clarityProjectId) }}
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
 * call, Matomo's own `trackPageView`, Clarity's own session recording, and for
 * GTM the container's All Pages trigger — so this component deliberately skips
 * its first run and reports only changes. Anything else would double-count the
 * landing page.
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

    // Both Google ids are configured through gtag, so either one means a
    // navigation has to be reported by hand.
    if ((config.ga4MeasurementId !== "" || config.googleTagId !== "") && typeof window.gtag === "function") {
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
    // Clarity is absent for the same reason: it records the session, and its
    // own tag follows the history change without being told.
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
 * GA4 and the Google tag. The `config` call sends the landing pageview, so it
 * is not repeated here.
 */
function gtagSnippet(tagId: string): string {
  return (
    "window.dataLayer = window.dataLayer || [];" +
    "function gtag(){window.dataLayer.push(arguments);}" +
    "window.gtag = gtag;" +
    "gtag('js', new Date());" +
    `gtag('config', ${jsonForScript(tagId)});` +
    "(function(){var s=document.createElement('script');s.async=true;" +
    `s.src='https://www.googletagmanager.com/gtag/js?id='+${jsonForScript(tagId)};` +
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

/**
 * Microsoft Clarity, in the shape its own snippet ships.
 *
 * It is the one provider here that reports more than a visit: it records the
 * session and builds heatmaps, so it collects considerably more than a
 * pageview. The project id is the only part of the snippet that varies.
 */
function claritySnippet(projectId: string): string {
  return (
    "(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};" +
    "t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;" +
    "y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})" +
    `(window, document, 'clarity', 'script', ${jsonForScript(projectId)});`
  );
}
