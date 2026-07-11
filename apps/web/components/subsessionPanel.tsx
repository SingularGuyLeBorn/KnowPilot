"use client";

/**
 * 子会话面板 —— 列出当前父会话派生的 kind="subagent" 子会话入口。
 * 数据由父组件通过 trpc.session.listChildren 查询提供，保证与乐观更新/轮询同源。
 */

import { Loader2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ChatSession } from "@knowpilot/shared";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
};

const STATUS_DOT: Record<string, string> = {
  queued: "bg-amber-400",
  running: "bg-green-500 animate-pulse",
  completed: "bg-blue-400",
  failed: "bg-red-500",
  paused: "bg-gray-400",
};

export function SubsessionPanel({
  items,
  isLoading,
  activeSessionId,
  onSelectSession,
}: {
  items: ChatSession[];
  isLoading?: boolean;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--kp-text-3)]" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-[var(--kp-text-3)]" data-testid="subsession-empty">
        暂无子 Agent 会话
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2" data-testid="subsession-panel">
      {items.map((s) => {
        const active = activeSessionId === s.id;
        const status = s.status ?? "unknown";
        return (
          <button
            key={s.id}
            type="button"
            data-testid="subsession-item"
            onClick={() => onSelectSession(s.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition",
              active
                ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand)]/10 text-[var(--kp-brand-deep)]"
                : "border-transparent hover:border-[var(--kp-divider)] hover:bg-[var(--kp-bg-mute)]/50 text-[var(--kp-text-2)]",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                STATUS_DOT[status] ?? "bg-gray-400",
              )}
              title={STATUS_LABEL[status] ?? status}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.title}</div>
              <div className="truncate text-[10px] text-[var(--kp-text-3)]">
                {STATUS_LABEL[status] ?? status} · {formatRelativeTime(s.updatedAt)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
