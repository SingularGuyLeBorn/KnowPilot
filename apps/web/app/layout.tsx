import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayoutClient } from "@/components/layout/AppLayoutClient";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KnowPilot — 智能知识管理与博客平台",
  description: "基于 Next.js + React + tRPC 的智能知识管理与博客平台",
  applicationName: "KnowPilot",
  appleWebApp: {
    capable: true,
    title: "KnowPilot",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/robot.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/robot.svg", type: "image/svg+xml" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          id="kp-theme-init"
          dangerouslySetInnerHTML={{
            __html: `(function() {
  try {
    const stored = localStorage.getItem("kp-theme");
    const resolved = stored === "light" || stored === "dark" ? stored : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(resolved);
  } catch {}
})()`,
          }}
        />
      </head>
      <body className="min-h-full bg-[var(--kp-bg)] text-[var(--kp-text)]">
        <TooltipProvider>
          <Providers>
            <AppLayoutClient>{children}</AppLayoutClient>
          </Providers>
        </TooltipProvider>
      </body>
    </html>
  );
}
