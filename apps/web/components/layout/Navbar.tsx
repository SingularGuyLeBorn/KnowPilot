"use client";

import Link from "next/link";
import { PenLine, MessageSquare, Bot, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";

interface NavbarProps {
  onMenuClick?: () => void;
  className?: string;
}

export function Navbar({ onMenuClick, className }: NavbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-[var(--kp-divider)]",
        "bg-[var(--kp-glass-bg)] backdrop-blur-md",
        className
      )}
    >
      <div className="flex h-16 w-full items-center justify-between px-[4%] md:px-[6%] lg:px-[8%] xl:px-[10%]">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="rounded-lg p-2 text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] lg:hidden"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[var(--kp-text-1)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand)] text-white">
              K
            </span>
            <span>KnowPilot</span>
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/posts" icon={<PenLine className="h-4 w-4" />}>
            文章
          </NavLink>
          <NavLink href="/chat" icon={<MessageSquare className="h-4 w-4" />}>
            聊天
          </NavLink>
          <NavLink href="/agents" icon={<Bot className="h-4 w-4" />}>
            Agents
          </NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <CommandPalette />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
    >
      {icon}
      {children}
    </Link>
  );
}
