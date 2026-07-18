"use client";

/**
 * 运行栏「旁路复盘」—— skill_review 子会话列表（不混入投递队列）。
 */

import Link from "next/link";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function statusLabel(status: string): string {
  if (status === "running") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return status;
}

function statusTone(status: string): string {
  if (status === "running") return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  if (status === "completed") return "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300";
  if (status === "failed") return "bg-red-500/12 text-red-700 dark:text-red-300";
  return "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]";
}

export function SideRunsPanel({
  parentSessionId,
  onOpenSession,
}: {
  parentSessionId: string | null;
  onOpenSession?: (id: string) => void;
}) {
  const query = trpc.session.listSideRuns.useQuery(
    { parentSessionId: parentSessionId!, pageSize: 30 },
    { enabled: !!parentSessionId, refetchInterval: 8_000 },
  );

  if (!parentSessionId) {
    return (
      <p className="px-3 py-4 text-center text-[11px] text-[var(--kp-text-3)]">
        选择会话后可查看旁路复盘
      </p>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-[11px] text-[var(--kp-text-3)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载复盘…
      </div>
    );
  }

  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-[11px] text-[var(--kp-text-3)]">
        暂无 Skill 复盘。工具调用够多时会自动创建，可点开查看过程。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--kp-divider)]" data-testid="side-runs-panel">
      {items.map((item) => (
        <li key={item.id} className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Sparkles className="h-3 w-3 shrink-0 text-[var(--kp-brand-deep)]" />
                <span className="truncate text-xs font-medium text-[var(--kp-text-1)]">
                  {item.title}
                </span>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                    statusTone(item.status),
                  )}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--kp-text-3)]">
                {item.model}
              </p>
            </div>
            {onOpenSession ? (
              <button
                type="button"
                onClick={() => onOpenSession(item.id)}
                className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
              >
                打开
              </button>
            ) : (
              <Link
                href={`/chat?sessionId=${item.id}&view=sub`}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
              >
                打开 <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
