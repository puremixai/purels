import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Purels 管理后台",
  description: "Purels 链接管理与运营后台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
