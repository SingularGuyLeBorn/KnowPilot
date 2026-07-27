"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";
import {
  clearReadingEntry,
  getEntryByPostId,
  getMainScrollEl,
  shouldRestoreProgress,
  upsertReadingProgress,
} from "@/lib/readingHistory";
import { cn } from "@/lib/utils";

interface ReadingProgressTrackerProps {
  postId: string;
  slug: string;
  garden: string;
  title: string;
  /** 文章根节点，用于计算进度 */
  articleRef: React.RefObject<HTMLElement | null>;
}

/**
 * 文章页阅读进度：滚动时写入 localStorage；若有未读完进度则恢复并提示。
 * 进页先恢复再写盘，避免首帧 scrollTop=0 覆盖上次进度。
 */
export function ReadingProgressTracker({
  postId,
  slug,
  garden,
  title,
  articleRef,
}: ReadingProgressTrackerProps) {
  const [banner, setBanner] = useState<"restored" | null>(null);
  const saveTimer = useRef<number | null>(null);
  const readyToSaveRef = useRef(false);

  useEffect(() => {
    const main = getMainScrollEl();
    if (!main) return;

    readyToSaveRef.current = false;

    const entry = getEntryByPostId(postId);
    const shouldRestore = !!entry && shouldRestoreProgress(entry);
    let cancelled = false;

    const persist = () => {
      if (!readyToSaveRef.current) return;
      const article = articleRef.current;
      if (!article) return;
      const scrollTop = main.scrollTop;
      const maxScroll = Math.max(1, main.scrollHeight - main.clientHeight);
      const progress = Math.min(1, scrollTop / maxScroll);
      upsertReadingProgress({
        postId,
        slug,
        garden,
        title,
        progress,
        scrollTop,
      });
    };

    const unlockSave = () => {
      if (cancelled || readyToSaveRef.current) return;
      readyToSaveRef.current = true;
      // 恢复完成（或无需恢复）后再记一条，保证「上次阅读」有入口且不抹掉进度
      persist();
    };

    const restore = () => {
      if (cancelled || !shouldRestore || !entry) return;
      const maxScroll = Math.max(0, main.scrollHeight - main.clientHeight);
      const target = Math.min(entry.scrollTop, maxScroll);
      if (target < 40) return;
      main.scrollTo({ top: target, behavior: "auto" });
      setBanner("restored");
    };

    // Shell 在 pathname 变化时会 scrollTo(0)；等其 effect 跑完再恢复
    const t1 = window.setTimeout(() => {
      restore();
    }, 80);
    const t2 = window.setTimeout(() => {
      restore();
      unlockSave();
    }, 280);
    // 无需恢复时尽快开写，避免短暂浏览无记录
    const tUnlock = window.setTimeout(() => {
      if (!shouldRestore) unlockSave();
    }, 100);

    const onScroll = () => {
      if (!readyToSaveRef.current) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 280);
    };

    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(tUnlock);
      main.removeEventListener("scroll", onScroll);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // 离开页：若已开写则落盘最终位置
      if (readyToSaveRef.current) persist();
    };
  }, [postId, slug, garden, title, articleRef]);

  if (banner !== "restored") return null;

  return (
    <div
      className={cn(
        "mb-4 flex items-center gap-2 rounded-xl border border-[var(--kp-brand)]/25",
        "bg-[var(--kp-brand-soft)] px-3 py-2 text-xs text-[var(--kp-brand-deep)]",
      )}
      role="status"
    >
      <BookOpen className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">已跳到上次阅读位置</span>
      <button
        type="button"
        className="shrink-0 rounded-md px-2 py-0.5 font-medium hover:bg-[var(--kp-bg-alt)]"
        onClick={() => {
          const main = getMainScrollEl();
          main?.scrollTo({ top: 0, behavior: "smooth" });
          setBanner(null);
        }}
      >
        回到顶部
      </button>
      <button
        type="button"
        className="shrink-0 rounded p-1 hover:bg-[var(--kp-bg-alt)]"
        aria-label="关闭提示"
        onClick={() => setBanner(null)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="shrink-0 rounded-md px-2 py-0.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-2)]"
        onClick={() => {
          clearReadingEntry(postId);
          setBanner(null);
        }}
      >
        清除记录
      </button>
    </div>
  );
}
