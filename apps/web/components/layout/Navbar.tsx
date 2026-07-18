"use client";

import Link from "next/link";
import { KnowPilotLogo } from "@/lib/icons";
import { usePathname } from "next/navigation";
import { Bot, Menu, PenLine, PlusCircle, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "@/components/themeToggle";
import type { LayoutMode } from "./layoutMode";

interface NavbarProps {
  mode: LayoutMode;
  onMenuClick?: () => void;
  className?: string;
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

        {/* 桌面顶栏；窄屏改走底栏，避免横向挤爆 */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          <TopNavLink href="/posts" active={pathname.startsWith("/posts")} icon={<PenLine className="h-4 w-4" />}>
            文章
          </TopNavLink>
          <TopNavLink href="/editor" active={pathname.startsWith("/editor")} icon={<PlusCircle className="h-4 w-4" />}>
            写作
          </TopNavLink>
          <TopNavLink href="/agents" active={pathname.startsWith("/agents") || pathname.startsWith("/chat")} icon={<Bot className="h-4 w-4" />}>
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
