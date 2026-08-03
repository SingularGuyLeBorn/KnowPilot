"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { MobileBottomNav } from "./mobileNav";
import { getLayoutMode, showPostSidebar, showSystemSidebar } from "./layoutMode";
import { cn } from "@/lib/utils";
import { MainScrollProvider } from "./MainScrollContext";

/**
 * 侧栏按模式动态加载，避免根布局静态吞进 PostTreeNav → shared → hooks 整图。
 * 管理页（/agents 等）不再编译文章树；文章页再拉 PostSidebar chunk。
 */
const Sidebar = dynamic(() => import("./Sidebar").then((m) => m.Sidebar), {
  ssr: false,
  loading: () => null,
});
const PostSidebar = dynamic(() => import("./PostSidebar").then((m) => m.PostSidebar), {
  ssr: false,
  loading: () => null,
});

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
        {systemSidebar && <Sidebar className="hidden lg:flex" />}

        {postSidebar && <PostSidebar className="hidden lg:flex" />}

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

        <MainScrollProvider rootRef={mainRef}>
          <main
            ref={mainRef}
            data-kp-main-scroll
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--kp-bg)]",
              "pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0",
              className,
            )}
          >
            {children}
          </main>
        </MainScrollProvider>
      </div>

      {pathname !== "/login" && <MobileBottomNav />}
    </div>
  );
}
