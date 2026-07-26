"use client";

import Link from "next/link";
import { KnowPilotLogo } from "@/lib/icons";
import { usePathname } from "next/navigation";
import { BookOpen, Bot, Menu, MessageSquare, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "@/components/themeToggle";
import type { LayoutMode } from "./layoutMode";

interface NavbarProps {
  mode: LayoutMode;
  onMenuClick?: () => void;
  className?: string;
}

/** 内容域：库首页 / 文章列表 / 编辑器都算「知识库」高亮，不拆成三个顶栏入口 */
function isKnowledgeActive(pathname: string): boolean {
  return (
    pathname.startsWith("/gardens") ||
    pathname.startsWith("/posts") ||
    pathname.startsWith("/editor") ||
    pathname.startsWith("/categories") ||
    pathname.startsWith("/tags")
  );
}

export function Navbar({ mode, onMenuClick, className }: NavbarProps) {
  const pathname = usePathname();
  const showMobileMenu = mode === "app" || mode === "content";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 shrink-0 border-b border-[var(--kp-divider)]",
        "bg-[var(--kp-glass-bg)] backdrop-blur-md",
        className,
      )}
    >
      <div className="flex h-14 w-full items-center gap-3 px-3 md:gap-4 md:px-6">
        {showMobileMenu && (
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] lg:hidden"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-[var(--kp-text-1)]"
        >
          <KnowPilotLogo size={32} className="shrink-0" />
          <span className="hidden sm:inline">KnowPilot</span>
        </Link>

        {/* 产品顶栏：知识库（内容）· 对话 · Agents · About。文章/写作不进顶栏，从库内进入。 */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          <TopNavLink href="/gardens" active={isKnowledgeActive(pathname)} icon={<BookOpen className="h-4 w-4" />}>
            知识库
          </TopNavLink>
          <TopNavLink
            href="/chat"
            active={pathname.startsWith("/chat")}
            icon={<MessageSquare className="h-4 w-4" />}
          >
            对话
          </TopNavLink>
          <TopNavLink
            href="/agents"
            active={pathname.startsWith("/agents")}
            icon={<Bot className="h-4 w-4" />}
          >
            Agents
          </TopNavLink>
          <TopNavLink href="/about" active={pathname.startsWith("/about")} icon={<UserCircle className="h-4 w-4" />}>
            About
          </TopNavLink>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
          <CommandPalette />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function TopNavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
          : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
      )}
    >
      {icon}
      <span className="hidden md:inline">{children}</span>
    </Link>
  );
}
