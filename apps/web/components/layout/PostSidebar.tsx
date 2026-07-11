"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PostTreeNav } from "@/components/post/PostTreeNav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, PlusCircle } from "lucide-react";

interface PostSidebarProps {
  className?: string;
}

const SIDEBAR_WIDTH_KEY = "kp-post-sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 280;

/** 文章专用侧栏 — 仅文档目录树，与系统导航完全分离（对齐 MetaBlog GlobalSidebar）
 *  支持拖拽调整宽度（持久化到 localStorage） */
export function PostSidebar({ className }: PostSidebarProps) {
  const pathname = usePathname();
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(saved))) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch {
        // ignore
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [width]);

  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        className,
      )}
      style={{ width: `${width}px` }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-[var(--kp-brand-deep)]" />
          <span className="text-sm font-semibold text-[var(--kp-text-1)]">文档目录</span>
        </div>
        <Link
          href="/editor"
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition",
            pathname.startsWith("/editor")
              ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
              : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
          )}
          title="新建文章"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          新建
        </Link>
      </div>
      <PostTreeNav className="min-h-0 flex-1" />
      {/* 拖拽调整宽度的手柄 */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--kp-brand)]/30 active:bg-[var(--kp-brand)]/50"
        aria-label="拖拽调整侧栏宽度"
      />
    </aside>
  );
}
