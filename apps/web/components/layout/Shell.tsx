"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { PostSidebar } from "./PostSidebar";
import { MobileBottomNav } from "./mobileNav";
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
  const showDrawer = mobileMenuOpen && (systemSidebar || postSidebar);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden pt-[env(safe-area-inset-top,0px)]">
      <Navbar mode={mode} onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 桌面：系统侧栏（仅 Agent / 运维页） */}
        {systemSidebar && <Sidebar className="hidden lg:flex" />}

        {/* 桌面：文档侧栏（仅文章 / 编辑器页） */}
        {postSidebar && <PostSidebar className="hidden lg:flex" />}

        {/* 移动端侧栏抽屉（底栏「更多」之外的分组导航） */}
        {showDrawer && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden
            />
            {systemSidebar && (
              <Sidebar
                className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] max-w-full pt-14 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:hidden"
                onNavigate={() => setMobileMenuOpen(false)}
              />
            )}
            {postSidebar && (
              <PostSidebar
                className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] max-w-full pt-14 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:hidden"
                onNavigate={() => setMobileMenuOpen(false)}
              />
            )}
          </>
        )}

        <main
          ref={mainRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--kp-bg)]",
            /* 为固定底栏留空；Chat 自己也会吃满高度，额外 padding 避免输入被挡 */
            "pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0",
            className,
          )}
        >
          {children}
        </main>
      </div>

      {pathname !== "/login" && <MobileBottomNav />}
    </div>
  );
}
