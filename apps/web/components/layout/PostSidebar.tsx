"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PostTreeNav } from "@/components/post/PostTreeNav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, FolderOpen, PlusCircle } from "lucide-react";
import { useContentGardenScope } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

interface PostSidebarProps {
  className?: string;
  onNavigate?: () => void;
}

const SIDEBAR_WIDTH_KEY = "kp-post-sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 280;

/** 文章专用侧栏 — 进入某座库后只显示该库目录（对齐「先选书架再翻书」） */
export function PostSidebar({ className, onNavigate }: PostSidebarProps) {
  const pathname = usePathname();
  const { gardenId, isScoped } = useContentGardenScope();
  const { data: gardenMeta } = trpc.garden.getById.useQuery(
    { id: gardenId! },
    { enabled: !!gardenId && isScoped },
  );

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

  const title = isScoped
    ? (gardenMeta?.title || gardenId || "本库目录")
    : "全部知识库";
  const newHref = gardenId
    ? `/editor?garden=${encodeURIComponent(gardenId)}`
    : "/editor";

  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        className,
      )}
      style={onNavigate ? undefined : { width: `${width}px` }}
      onClickCapture={(e) => {
        if (!onNavigate) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("a[href]")) onNavigate();
      }}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--kp-divider)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-[var(--kp-brand-deep)]" />
            <span className="truncate text-sm font-semibold text-[var(--kp-text-1)]" title={title}>
              {title}
            </span>
          </div>
          <Link
            href={newHref}
            onClick={() => onNavigate?.()}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition",
              pathname.startsWith("/editor")
                ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
            )}
            title="新建文章"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            新建
          </Link>
        </div>
        {isScoped && (
          <Link
            href="/gardens"
            onClick={() => onNavigate?.()}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--kp-text-3)] transition hover:text-[var(--kp-brand-deep)]"
          >
            <ArrowLeft className="h-3 w-3" />
            全部知识库
          </Link>
        )}
      </div>
      <PostTreeNav className="min-h-0 flex-1" gardenId={isScoped ? gardenId : null} />
      {!onNavigate && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--kp-brand)]/30 active:bg-[var(--kp-brand)]/50"
          aria-label="拖拽调整侧栏宽度"
        />
      )}
    </aside>
  );
}
