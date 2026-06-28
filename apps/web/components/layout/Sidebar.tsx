"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

const STORAGE_KEY = "kp-sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

export function Sidebar({ className }: SidebarProps) {
  // SSR 与首次客户端渲染必须使用相同默认值，避免 hydration mismatch。
  // localStorage 中保存的宽度在 effect 中通过 queueMicrotask 异步恢复。
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(saved))));
        }
      } catch {
        // ignore
      }
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: PointerEvent) => {
      const delta = e.clientX - startXRef.current;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    };

    const handleUp = () => {
      setIsResizing(false);
      try {
        localStorage.setItem(STORAGE_KEY, String(width));
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
    };
  }, [isResizing, width]);

  return (
    <aside
      suppressHydrationWarning
      className={cn(
        "relative flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        isResizing && "select-none",
        className
      )}
      style={{ width }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <nav className="space-y-1 p-4">
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

        <div className="flex-1 min-h-0 px-4 pb-4">
          <PostTreeNav className="h-full" />
        </div>

        <div className="border-t border-[var(--kp-divider)] p-4">
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]">
            <Settings className="h-4 w-4" />
            设置
          </button>
        </div>
      </div>

      {/* resize handle */}
      <div
        onPointerDown={handlePointerDown}
        className={cn(
          "absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[var(--kp-brand)]/20",
          isResizing && "bg-[var(--kp-brand)]/30"
        )}
        aria-label="调整侧边栏宽度"
        role="separator"
      />
    </aside>
  );
}
