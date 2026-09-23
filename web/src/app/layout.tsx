import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AnalyticsInjector } from "@/components/analytics-injector";
import { I18nProvider } from "@/components/i18n-provider";
import { ToastProvider } from "@/components/toast-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { publicAnalyticsConfig } from "@/lib/analytics-config.server";
import { tFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { requestOrigin } from "@/lib/request-origin";
import "./globals.css";

// Reading the locale cookie makes this layout request-time, which is why the
// metadata is generated rather than a static export: Next refuses to build a
// file that exports both `metadata` and `generateMetadata`.
//
// metadataBase is what turns a page's relative canonical into an absolute URL.
// It is set here so every page gets it, but `alternates` is deliberately not:
// metadata merges down the segment tree, so a canonical set at this level would
// be inherited by /home, /login and /register and point all three at the
// homepage.
export async function generateMetadata(): Promise<Metadata> {
  const t = tFor(await getLocale());
  return {
    metadataBase: new URL(await requestOrigin()),
    title: t("app.title"),
    description: t("app.description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  // Read here rather than in the injector so every page carries the trackers
  // from the first byte, and so one cached read serves every render. A null
  // answer renders nothing.
  const analytics = await publicAnalyticsConfig();
  return (
    <html className={`${GeistSans.variable} ${GeistMono.variable}`} data-theme="dark" lang={locale} suppressHydrationWarning>
      <body>
        {/*
          Applied before first paint. The provider also sets the theme, but it
          does so in an effect — a light-mode operator would load every page as
          dark for a frame first, which reads as a fault rather than a delay.
        */}
        <script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("purels-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}' }} />
        <AnalyticsInjector config={analytics} />
        <ThemeProvider>
          <I18nProvider locale={locale}>
            <ToastProvider>{children}</ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
