"use client";

/**
 * Goal / Deep Research 进度条：
 * - 仅在进行中 Goal/调研时展示（暂停/继续/清除）。
 * - 深度研究入口已挪到输入区 chip；本组件不再展示空会话推广闸。
 * - 子 Agent 会话不挂载本组件。
 */

import { Flag, Pause, Play, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { SessionGoalState } from "@knowpilot/shared";

export function ChatGoalBar({ sessionId }: { sessionId: string | null }) {
  const utils = trpc.useUtils();

  const goalQuery = trpc.session.getGoal.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchInterval: 5_000 },
  );

  const pauseMut = trpc.session.pauseGoal.useMutation({
    onSuccess: () => {
      if (sessionId) void utils.session.getGoal.invalidate({ sessionId });
    },
  });
  const resumeMut = trpc.session.resumeGoal.useMutation({
    onSuccess: () => {
      if (sessionId) void utils.session.getGoal.invalidate({ sessionId });
    },
  });
  const clearMut = trpc.session.clearGoal.useMutation({
    onSuccess: () => {
      if (sessionId) void utils.session.getGoal.invalidate({ sessionId });
    },
  });

  const goal = (sessionId ? goalQuery.data?.goal : null) as SessionGoalState | null | undefined;
  const goalActive = !!goal && goal.status !== "done" && goal.status !== "exhausted";

  if (!goalActive || !sessionId || !goal) return null;

  return (
    <div
      className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 px-3 py-1.5"
      data-testid="chat-goal-bar"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-[var(--kp-text-1)]">
          {goal.mode === "deep_research" ? (
            <Search className="h-3.5 w-3.5" />
          ) : (
            <Flag className="h-3.5 w-3.5" />
          )}
          {goal.mode === "deep_research" ? "调研" : "Goal"} {goal.turnsUsed}/{goal.maxTurns}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              goal.status === "active" && "bg-emerald-500/12 text-emerald-800",
              goal.status === "paused" && "bg-amber-500/15 text-amber-800",
            )}
          >
            {goal.status === "active" ? "进行中" : "已暂停"}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--kp-text-2)]" title={goal.text}>
          {goal.text}
        </span>
        {goal.status === "active" ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] hover:bg-[var(--kp-bg-mute)]"
            onClick={() => pauseMut.mutate({ sessionId })}
          >
            <Pause className="h-3 w-3" /> 暂停
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] hover:bg-[var(--kp-bg-mute)]"
            onClick={() => resumeMut.mutate({ sessionId })}
          >
            <Play className="h-3 w-3" /> 继续
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
          onClick={() => clearMut.mutate({ sessionId })}
        >
          <X className="h-3 w-3" /> 清除
        </button>
      </div>
    </div>
  );
}
