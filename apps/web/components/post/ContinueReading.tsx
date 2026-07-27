"use client";

import Link from "next/link";
import { BookMarked, ChevronRight } from "lucide-react";
import {
  readingEntryHref,
  shouldRestoreProgress,
  useLastRead,
  type ReadingHistoryEntry,
} from "@/lib/readingHistory";
import { cn } from "@/lib/utils";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
      <div
        className="h-full rounded-full bg-[var(--kp-brand)] transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 知识库首页 / 文章列表顶部的「继续阅读」卡片 */
export function ContinueReadingCard({
  garden,
  className,
}: {
  /** 限定某座花园；空则全局最近一篇 */
  garden?: string | null;
  className?: string;
}) {
  const last = useLastRead(garden);
  if (!last) return null;

  const unfinished = shouldRestoreProgress(last);
  const pct = Math.round(last.progress * 100);

  return (
    <Link
      href={readingEntryHref(last)}
      className={cn(
        "group flex items-start gap-3 rounded-2xl border border-[var(--kp-brand)]/30",
        "bg-[var(--kp-brand-soft)] p-4 transition hover:border-[var(--kp-brand)]/50 hover:bg-[color-mix(in_srgb,var(--kp-brand-soft)_80%,var(--kp-bg-alt))]",
        className,
      )}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-bg-alt)] text-[var(--kp-brand-deep)] shadow-sm">
        <BookMarked className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--kp-brand-deep)]">
          上次阅读
          <span className="font-normal normal-case tracking-normal text-[var(--kp-text-3)]">
            {formatRelative(last.updatedAt)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-[var(--kp-text-1)] group-hover:text-[var(--kp-brand-deep)]">
          {last.title}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--kp-text-3)]">
          {unfinished ? `已读约 ${pct}% · 点击继续` : pct >= 92 ? "已读完 · 再看一遍" : "点击打开"}
        </span>
        {unfinished && <ProgressBar progress={last.progress} />}
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[var(--kp-text-3)] transition group-hover:translate-x-0.5 group-hover:text-[var(--kp-brand-deep)]" />
    </Link>
  );
}

/** 侧栏紧凑「上次阅读」行 */
export function ContinueReadingSidebarLink({
  garden,
  onNavigate,
  className,
}: {
  garden?: string | null;
  onNavigate?: () => void;
  className?: string;
}) {
  const last = useLastRead(garden);
  if (!last) return null;

  return (
    <Link
      href={readingEntryHref(last)}
      onClick={() => onNavigate?.()}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-lg py-1.5 pr-1.5 text-left text-[11px] transition",
        "text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]",
        className,
      )}
      title={`上次阅读：${last.title}`}
    >
      <BookMarked className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">{last.title}</span>
      <span className="shrink-0 tabular-nums text-[var(--kp-text-3)]">
        {Math.round(last.progress * 100)}%
      </span>
    </Link>
  );
}

export type { ReadingHistoryEntry };
