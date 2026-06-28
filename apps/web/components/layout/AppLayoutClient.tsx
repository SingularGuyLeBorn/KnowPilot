"use client";

import { usePathname } from "next/navigation";
import { Shell } from "./Shell";
import { AuthGate } from "./AuthGate";
import { getLayoutMode } from "./layoutMode";

/** 全局持久布局：Sidebar / Navbar 不随路由 remount，避免点击导航时页面跳动 */
export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mode = getLayoutMode(pathname);

  const mainClass =
    pathname.startsWith("/editor") || mode === "chat"
      ? "overflow-hidden"
      : pathname === "/"
        ? "overflow-x-hidden"
        : undefined;

  return (
    <AuthGate>
      <Shell className={mainClass}>{children}</Shell>
    </AuthGate>
  );
}
