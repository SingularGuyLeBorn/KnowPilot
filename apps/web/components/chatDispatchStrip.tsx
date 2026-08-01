"use client";

/**
 * 中栏仅保留一行摘要入口，任务卡片只在左栏「运行」里出现，避免双显。
 */

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatQueueItem, SyncTaskItem } from "@/lib/chatQueueTypes";

export function ChatDispatchStrip({
  activeItems,
  toConsumeItems,
  syncTasks,
  onOpenRuntimePanel,
  className,
}: {
  activeItems: ChatQueueItem[];
  toConsumeItems: ChatQueueItem[];
  syncTasks?: SyncTaskItem[];
  onSelectSession?: (sessionId: string) => void;
  onOpenRuntimePanel?: () => void;
  onCancelJob?: (jobId: string) => void;
  className?: string;
}) {
  const syncRunning =
    syncTasks?.filter((t) => t.status === "running" || t.status === "queued").length ?? 0;
  const count = activeItems.length + toConsumeItems.length + syncRunning;
  if (count === 0) return null;

  const executing = activeItems.filter((i) => i.status !== "queued").length;
  const waiting = activeItems.filter((i) => i.status === "queued").length;
  const ready = toConsumeItems.length;

  const bits: string[] = [];
  if (executing > 0) bits.push(`${executing} 执行中`);
  if (waiting > 0) bits.push(`${waiting} 等待中`);
  if (ready > 0) bits.push(`${ready} 待消费`);
  if (syncRunning > 0) bits.push(`${syncRunning} 同步`);

  return (
    <div
      className={cn(
        "border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 px-3 py-2",
        className,
      )}
      data-testid="chat-dispatch-strip"
    >
      <button
        type="button"
        onClick={onOpenRuntimePanel}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-[var(--kp-bg-mute)]/60"
        title="在左栏运行面板查看任务列表"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--kp-text-2)]">
          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
          <span className="truncate">后台任务</span>
          <span className="rounded-full bg-[var(--kp-brand-soft)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--kp-brand-deep)]">
            {count}
          </span>
          {bits.length > 0 && (
            <span className="truncate font-normal text-[var(--kp-text-3)]">· {bits.join(" · ")}</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--kp-text-3)] underline-offset-2 hover:underline">
          打开运行栏
        </span>
      </button>
    </div>
  );
}
