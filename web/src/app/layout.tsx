import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { I18nProvider } from "@/components/i18n-provider";
import { ThemeProvider } from "@/components/theme-provider";
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
// be inherited by /admin, /login and /register and point all three at the
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
  return (
    <html className={`${GeistSans.variable} ${GeistMono.variable}`} data-theme="dark" lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("purels-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider locale={locale}>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
