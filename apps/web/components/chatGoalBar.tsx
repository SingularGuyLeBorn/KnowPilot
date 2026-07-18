"use client";

/**
 * Goal / Deep Research 条：
 * - Goal：平时不展示入口（用输入框 /goal 唤起）；有进行中 Goal 时显示进度。
 * - Deep Research：仅空会话（尚未发过用户消息）显示入口；一旦有消息即消失。
 * - 子 Agent 会话不挂载本组件。
 */

import { useState } from "react";
import { Flag, Pause, Play, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { FreeModelPicker } from "@/components/freeModelPicker";
import type { SessionGoalState } from "@knowpilot/shared";

export function ChatGoalBar({
  sessionId,
  allowDeepResearch,
  onToast,
}: {
  sessionId: string | null;
  /** 空主会话才为 true；有消息后永久 false */
  allowDeepResearch: boolean;
  onToast?: (msg: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [judgeModel, setJudgeModel] = useState("auto");
  const [showModel, setShowModel] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const utils = trpc.useUtils();

  const goalQuery = trpc.session.getGoal.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchInterval: 5_000 },
  );

  const setGoalMut = trpc.session.setGoal.useMutation({
    onSuccess: async () => {
      if (sessionId) await utils.session.getGoal.invalidate({ sessionId });
      setDraft("");
      setResearchOpen(false);
      onToast?.("深度调研已启动");
    },
    onError: (err) => onToast?.(err.message),
  });
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

  const startResearch = () => {
    if (!sessionId) {
      onToast?.("请先进入会话（打开主会话或先发一条消息创建会话）后再启动深度调研");
      return;
    }
    const text = draft.trim();
    if (!text) {
      onToast?.("请先写调研主题");
      return;
    }
    setGoalMut.mutate({
      sessionId,
      text,
      mode: "deep_research",
      judgeModel,
      startNow: true,
    });
  };

  if (goalActive && sessionId) {
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

  if (!allowDeepResearch) return null;

  return (
    <div
      className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 px-3 py-1.5"
      data-testid="chat-deep-research-gate"
    >
      {researchOpen ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--kp-brand-deep)]">
              <Search className="h-3.5 w-3.5" />
              深度调研（仅首条消息前可选）
            </span>
            <button
              type="button"
              onClick={() => setShowModel((v) => !v)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
            >
              裁判模型: {judgeModel === "auto" ? "自动最强免费" : judgeModel}
            </button>
            <button
              type="button"
              onClick={() => setResearchOpen(false)}
              className="ml-auto rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={setGoalMut.isPending}
              onClick={startResearch}
              className="rounded-md bg-[var(--kp-brand)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {setGoalMut.isPending ? "启动中…" : "开始调研"}
            </button>
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                startResearch();
              }
            }}
            placeholder="调研主题，例如：对比 X 与 Y 的最新进展并给结论"
            className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--kp-brand)]"
            autoFocus
          />
          {showModel && (
            <FreeModelPicker value={judgeModel} onChange={setJudgeModel} className="pt-1" />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[var(--kp-text-3)]">新会话可选</span>
          <button
            type="button"
            onClick={() => setResearchOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
            data-testid="chat-research-open"
          >
            <Search className="h-3 w-3" />
            深度调研
          </button>
          <span className="text-[10px] text-[var(--kp-text-3)]">
            目标请用输入框 <code className="rounded bg-[var(--kp-bg-mute)] px-1">/goal 内容</code>
          </span>
        </div>
      )}
    </div>
  );
}
