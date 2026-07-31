import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
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
  title: "见微 · OasisMind — 本地优先的数字主力",
  description: "见微知著：以 Markdown 为原子、AI 为引擎的本地优先知识花园与数字主力",
  applicationName: "见微",
  appleWebApp: {
    capable: true,
    title: "见微",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/oasismind.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/oasismind.svg", type: "image/svg+xml" }],
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
    { media: "(prefers-color-scheme: light)", color: "#f3f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121816" },
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
      spellCheck={false}
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
