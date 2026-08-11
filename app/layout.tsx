import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3001";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "US LENS",
  title: {
    default: "US LENS｜美股盘前与盘后热点简报",
    template: "%s｜US LENS",
  },
  description:
    "自动归档中文美股盘前与盘后热点，清楚区分事实、市场解读、待验证信息与风险提示。",
  openGraph: {
    title: "US LENS｜美股盘前与盘后热点简报",
    description: "看懂今天发生了什么、为什么重要、接下来验证什么。",
    type: "website",
    locale: "zh_CN",
    siteName: "US LENS",
    images: [
      {
        url: `${basePath}/og-us-lens.png`,
        width: 1200,
        height: 630,
        alt: "US LENS 美股盘前与盘后热点简报",
      },
    ],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1117" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
