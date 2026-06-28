"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { PostSidebar } from "./PostSidebar";
import { getLayoutMode, showPostSidebar, showSystemSidebar } from "./layoutMode";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: React.ReactNode;
  className?: string;
}

export function Shell({ children, className }: ShellProps) {
  const pathname = usePathname();
  const [menuState, setMenuState] = useState({ path: pathname, open: false });

  if (menuState.path !== pathname) {
    setMenuState({ path: pathname, open: false });
  }

  const mobileMenuOpen = menuState.open;
  const setMobileMenuOpen = (open: boolean) => setMenuState({ path: pathname, open });

  const mainRef = useRef<HTMLElement>(null);
  const mode = getLayoutMode(pathname);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  const systemSidebar = showSystemSidebar(mode);
  const postSidebar = showPostSidebar(mode);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Navbar mode={mode} onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)} />

      <div className="flex flex-1 overflow-hidden">
        {/* 桌面：系统侧栏（仅 Agent / 运维页） */}
        {systemSidebar && <Sidebar className="hidden lg:flex" />}

        {/* 桌面：文档侧栏（仅文章 / 编辑器页） */}
        {postSidebar && <PostSidebar className="hidden lg:flex" />}

        {/* 移动端侧栏 overlay */}
        {mobileMenuOpen && (systemSidebar || postSidebar) && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            {systemSidebar && (
              <Sidebar className="fixed inset-y-0 left-0 z-50 flex pt-16 lg:hidden" />
            )}
            {postSidebar && (
              <PostSidebar className="fixed inset-y-0 left-0 z-50 flex pt-16 lg:hidden" />
            )}
          </>
        )}

        <main
          ref={mainRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--kp-bg)]",
            className,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
