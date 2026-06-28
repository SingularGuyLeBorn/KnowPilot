"use client";

import { cn } from "@/lib/utils";
import { PostTreeNav } from "@/components/post/PostTreeNav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, PlusCircle } from "lucide-react";

interface PostSidebarProps {
  className?: string;
}

/** 文章专用侧栏 — 仅文档目录树，与系统导航完全分离（对齐 MetaBlog GlobalSidebar） */
export function PostSidebar({ className }: PostSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex w-[280px] shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-[var(--kp-brand)]" />
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
    </aside>
  );
}
