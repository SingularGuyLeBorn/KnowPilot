"use client";

import Link from "next/link";
import { Home, PenLine, MessageSquare, Bot, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostTreeNav } from "@/components/post/PostTreeNav";

interface SidebarProps {
  className?: string;
}

const navItems = [
  { href: "/", icon: Home, label: "首页" },
  { href: "/posts", icon: PenLine, label: "文章" },
  { href: "/chat", icon: MessageSquare, label: "聊天" },
  { href: "/agents", icon: Bot, label: "Agents" },
];

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex w-64 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        className
      )}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--kp-text-2)] transition hover:translate-x-[3px] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          <PostTreeNav />
        </div>
      </div>

      <div className="border-t border-[var(--kp-divider)] p-4">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]">
          <Settings className="h-4 w-4" />
          设置
        </button>
      </div>
    </aside>
  );
}


