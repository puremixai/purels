import type { Metadata } from "next";
import { I18nProvider } from "@/components/i18n-provider";
import { tFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

// Reading the locale cookie makes this layout request-time, which is why the
// metadata is generated rather than a static export: Next refuses to build a
// file that exports both `metadata` and `generateMetadata`.
export async function generateMetadata(): Promise<Metadata> {
  const t = tFor(await getLocale());
  return { title: t("app.title"), description: t("app.description") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
