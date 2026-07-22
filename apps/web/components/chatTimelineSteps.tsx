"use client";

/**
 * Chat 时间线子组件——从 chat.tsx 拆出。
 * 包含 Thinking / Content / Tool 三类 step 与 ThinkingTimeline 容器。
 * 纯展示型，无外部状态依赖，可独立 memo / chunk。
 */

import { memo, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock, Loader2, Sparkles, X } from "lucide-react";
import { PostContent } from "@/components/post/PostContent";
import { StreamingPlainContent } from "@/components/streamingPlainContent";
import { cn } from "@/lib/utils";
import { formatToolResultHint, type TimelineStep } from "@/lib/chatMessageUtils";
import { ToolStepIcon, type ToolIconStatus } from "@/lib/toolIcons";

/** 从 sleep / wait 工具参数推断目标时长（ms） */
function sleepTargetMs(name: string, args: unknown): number | null {
  const base = name.replace(/^skill__/, "").replace(/^mcp__/, "");
  if (base === "sleep" || base === "wait") {
    return sleepDurationFromArgs(args);
  }
  // async_task_run(mode=tool, toolCall={tool:sleep,args:{seconds}})
  if (base === "async_task_run" && args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const toolCall = a.toolCall && typeof a.toolCall === "object"
      ? (a.toolCall as Record<string, unknown>)
      : null;
    const toolName = String(toolCall?.tool ?? a.tool ?? "");
    if (toolName !== "sleep" && toolName !== "wait") return null;
    const nested = (toolCall?.args ?? a.args ?? a.toolArgs) as unknown;
    return sleepDurationFromArgs(nested ?? a);
  }
  return null;
}

function sleepDurationFromArgs(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  if (typeof a.ms === "number" && Number.isFinite(a.ms)) return Math.max(0, a.ms);
  if (typeof a.seconds === "number" && Number.isFinite(a.seconds)) {
    return Math.max(0, Math.round(a.seconds * 1000));
  }
  return null;
}

function formatSleepCountdown(elapsedMs: number, targetMs: number | null): string {
  if (targetMs != null && targetMs > 0) {
    const remain = Math.max(0, targetMs - elapsedMs);
    const remainSec = Math.ceil(remain / 1000);
    const totalSec = Math.round(targetMs / 1000);
    if (remain <= 0) return `完成 · ${totalSec}s`;
    return `剩余 ${remainSec}s / ${totalSec}s`;
  }
  const sec = Math.floor(elapsedMs / 1000);
  return `已等待 ${sec}s`;
}

/**
 * 从工具名 + 参数推断执行模式（同步 / 异步）。
 * - sleep / wait：args.async === true → 异步；否则同步（默认阻塞）
 * - spawn_subagent / async_task_run：args.waitForResult === true → 同步；否则异步（默认投递）
 * 其余工具返回 null（不展示徽标）。
 */
function inferToolExecutionMode(
  name: string,
  args: unknown,
): { mode: "sync" | "async"; label: string } | null {
  const base = name.replace(/^skill__/, "").replace(/^mcp__/, "");
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;

  if (base === "sleep" || base === "wait") {
    const isAsync = a.async === true || a.async === "true";
    return { mode: isAsync ? "async" : "sync", label: isAsync ? "异步" : "同步" };
  }
  if (base === "spawn_subagent" || base === "async_task_run") {
    const waitForResult = a.waitForResult === true || a.waitForResult === "true";
    return { mode: waitForResult ? "sync" : "async", label: waitForResult ? "同步" : "异步" };
  }
  return null;
}

const ThinkingStep = memo(function ThinkingStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "thinking" }>;
  isLive?: boolean;
}) {
  const content = step.content.trim();
  const isEmpty = !content;
  // 默认展开；用户可点击折叠，流式中也可展开/折叠
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 bg-[var(--kp-bg-soft)] px-3 py-2 text-left text-[11px] font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]",
          !collapsed && "border-b border-[var(--kp-divider-light)]",
        )}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开思考" : "折叠思考"}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
        <span>Thinking</span>
        {isLive && <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
            collapsed ? "" : "rotate-90",
          )}
        />
      </button>
      {!collapsed && (
        <div className="max-h-[240vh] overflow-y-auto px-3 py-3">
          {isEmpty ? (
            isLive ? (
              <p className="text-xs text-[var(--kp-text-3)]">等待模型输出…</p>
            ) : null
          ) : isLive ? (
            <StreamingPlainContent
              content={content}
              className="prose-sm max-w-none text-xs text-[var(--kp-text-2)]"
            />
          ) : (
            <PostContent
              content={content}
              className="prose-sm max-w-none text-xs text-[var(--kp-text-2)] [&_p]:text-xs [&_li]:text-xs"
            />
          )}
        </div>
      )}
    </div>
  );
});

/** 中间正式回复（工具轮次中 probe 返回的 content，后续仍有工具调用）。进导轨，无圆点。
 *  样式与流式气泡 / 最终 assistant 气泡一致（rounded-2xl border px-4 py-3 prose-sm），
 *  避免「流式时大气泡 → 进时间线变平铺塌缩」的字体/块跳变。 */
const ContentStep = memo(function ContentStep({
  step,
}: {
  step: Extract<TimelineStep, { type: "content" }>;
}) {
  const content = step.content.trim();
  if (!content) return null;
  return (
    <div
      data-testid="intermediate-content-step"
      className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm"
    >
      <PostContent content={content} className="prose-sm max-w-none text-left" />
    </div>
  );
});

const ToolStep = memo(function ToolStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "tool" }>;
  isLive?: boolean;
}) {
  // 默认折叠（不展开详情）；用户可手动点击 summary 展开
  const [open, setOpen] = useState(false);
  const displayName =
    step.name === "__context_compact__" || step.name === "session_compact"
      ? "上下文压缩"
      : step.name === "__thinking__"
        ? "思考"
        : step.name === "__content__"
          ? "中间回复"
          : step.name === "__reflection__"
            ? "反思复核"
            : step.name.replace(/^skill__/, "Skill · ").replace(/^mcp__/, "MCP · ");
  const hasError =
    step.result &&
    typeof step.result === "object" &&
    step.result !== null &&
    "error" in (step.result as Record<string, unknown>);

  const targetMs = useMemo(() => sleepTargetMs(step.name, step.args), [step.name, step.args]);
  const showSleepTimer =
    step.status === "running" &&
    (targetMs != null || /(?:^|__)(?:sleep|wait)$/.test(step.name.replace(/^skill__|^mcp__/, "")));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showSleepTimer || !step.startedAt) return;
    // 立即同步 now，让计时器从 0 开始而非上次 render 的值；属外部时钟同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [showSleepTimer, step.startedAt, step.toolCallId]);

  const sleepHint =
    showSleepTimer && step.startedAt
      ? formatSleepCountdown(Math.max(0, now - step.startedAt), targetMs)
      : null;

  const execMode = useMemo(
    () => inferToolExecutionMode(step.name, step.args),
    [step.name, step.args],
  );

  const toolBaseName = step.name.replace(/^skill__/, "").replace(/^mcp__/, "");
  const isTodoWrite = toolBaseName === "todo_write";
  const askUserPending = useMemo(() => {
    if (toolBaseName !== "ask_user" || !step.result || typeof step.result !== "object") return null;
    const r = step.result as {
      askUserPending?: {
        askId?: string;
        question?: string;
        options?: string[];
        channel?: "ui" | "email";
      };
      askId?: string;
      question?: string;
      options?: string[];
      channel?: "ui" | "email";
      status?: string;
      error?: unknown;
    };
    if (r.error) return null;
    const marker = r.askUserPending;
    const askId = marker?.askId || r.askId;
    const question = marker?.question || r.question;
    if (!askId || !question) return null;
    if (r.status && r.status !== "waiting_for_user") return null;
    return {
      askId: String(askId),
      question: String(question),
      options: marker?.options ?? r.options,
      channel: marker?.channel ?? r.channel ?? "ui",
    };
  }, [toolBaseName, step.result]);
  const todoItems = useMemo(() => {
    if (!isTodoWrite || !step.result || typeof step.result !== "object") return null;
    const todos = (step.result as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return null;
    return todos
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        id: String(t.id ?? ""),
        content: String(t.content ?? ""),
        status: String(t.status ?? "pending"),
      }))
      .filter((t) => t.content);
  }, [isTodoWrite, step.result]);

  // R18：JSON.stringify 仅在展开时计算（折叠时不浪费 CPU），且 memo 化避免重复 stringify
  const argsJson = useMemo(() => (open ? JSON.stringify(step.args, null, 2) : ""), [open, step.args]);
  const resultJson = useMemo(
    () => (open && step.result !== undefined && !todoItems ? JSON.stringify(step.result, null, 2) : ""),
    [open, step.result, todoItems],
  );

  const iconStatus: ToolIconStatus =
    step.status === "running" ? "running" : hasError ? "error" : step.status === "done" ? "done" : "idle";

  const todoStatusLabel: Record<string, string> = {
    pending: "待办",
    in_progress: "进行中",
    completed: "完成",
    cancelled: "取消",
  };

  const displayNameAsk =
    toolBaseName === "ask_user" ? "向用户提问" : displayName;
  const waitingAsk = Boolean(askUserPending);

  return (
    <div
      data-testid="tool-pill"
      className={cn(
        "w-full overflow-hidden rounded-xl border shadow-sm transition-colors",
        step.status === "running" || waitingAsk
          ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30"
          : "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
      )}
    >
      <details open={open} className="group/tool" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-[var(--kp-text-2)]">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              step.status === "running" || waitingAsk
                ? "animate-pulse bg-[var(--kp-brand)]"
                : hasError
                  ? "bg-red-500"
                  : "bg-green-500",
            )}
          />
          <ToolStepIcon toolName={step.name} status={iconStatus} />
          <span className="min-w-0 truncate">{displayNameAsk}</span>
          {execMode && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                execMode.mode === "async"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-sky-100 text-sky-700",
              )}
              data-testid="tool-exec-mode"
            >
              {execMode.label}
            </span>
          )}
          {sleepHint && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-[var(--kp-brand)]"
              data-testid="tool-sleep-countdown"
            >
              <Clock className="h-3 w-3" />
              {sleepHint}
            </span>
          )}
          {step.status === "done" && !isLive && (
            <span
              className={cn(
                "ml-auto text-[10px]",
                hasError ? "text-red-600" : "text-[var(--kp-text-3)]",
              )}
              data-testid="tool-timing-hint"
            >
              {step.hint || formatToolResultHint(step.result) || (hasError ? "失败" : "")}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200 group-open/tool:rotate-90" />
        </summary>
        {open && (
          <div className="border-t border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/40 px-3 py-2">
            {todoItems ? (
              <ul
                className="space-y-1.5 text-[11px] text-[var(--kp-text-2)]"
                data-testid="todo-write-list"
              >
                {todoItems.map((t) => (
                  <li key={t.id || t.content} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none",
                        t.status === "completed"
                          ? "bg-green-100 text-green-700"
                          : t.status === "in_progress"
                            ? "bg-sky-100 text-sky-700"
                            : t.status === "cancelled"
                              ? "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]"
                              : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {todoStatusLabel[t.status] ?? t.status}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1",
                        t.status === "completed" || t.status === "cancelled"
                          ? "text-[var(--kp-text-3)] line-through"
                          : "",
                      )}
                    >
                      {t.content}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)]">
                  {argsJson}
                </pre>
                {step.result !== undefined && (
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--kp-divider-light)] pt-2 text-[10px] text-[var(--kp-text-2)]">
                    {resultJson}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </details>
    </div>
  );
});

const ProgressStep = memo(function ProgressStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "progress" }>;
  isLive?: boolean;
}) {
  const status = step.status;
  const icon =
    status === "failed" ? (
      <X className="h-3.5 w-3.5 shrink-0 text-red-500" />
    ) : status === "done" ? (
      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
    ) : status === "queued" ? (
      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
    ) : (
      <Loader2 className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]", isLive && "animate-spin")} />
    );
  return (
    <div
      data-testid="async-progress-step"
      className={cn(
        "w-full overflow-hidden rounded-xl border px-3 py-2 text-[11px] shadow-sm transition-colors",
        status === "failed"
          ? "border-red-200 bg-red-50"
          : status === "done"
            ? "border-green-200 bg-green-50"
            : "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30",
      )}
    >
      <div className="flex items-center gap-2 font-medium text-[var(--kp-text-2)]">
        {icon}
        <span className="min-w-0 truncate">{step.label}</span>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--kp-text-3)]">
          {status === "queued" && "排队中"}
          {status === "running" && "运行中"}
          {status === "done" && "已完成"}
          {status === "failed" && "失败"}
        </span>
      </div>
      {step.content && (
        <p className="mt-1 line-clamp-2 text-[10px] text-[var(--kp-text-3)]">{step.content}</p>
      )}
    </div>
  );
});

export function ThinkingTimeline({
  steps,
  isLive = false,
}: {
  steps: TimelineStep[];
  isLive?: boolean;
}) {
  // 历史/非末尾的空 Thinking 一律不渲染；直播中仅保留「正在等首 token」的最后一个空壳
  const visibleSteps = steps.filter((step, i) => {
    if (step.type !== "thinking") return true;
    if (step.content.trim()) return true;
    return isLive && i === steps.length - 1;
  });
  if (!visibleSteps.length) return null;

  // 左右边缘与 assistant 气泡完全对齐（同 ml-6 mr-2 max-w-[96%]，无内缩），
  // 避免中间回复「流式全宽 → 进时间线变窄」的跳变。
  // 竖线导轨放在气泡左侧 margin 区（absolute 负偏移，不占布局宽度），对标 Kimi Code。
  return (
    <div
      className="relative mb-2 ml-6 mr-2 w-full max-w-[96%]"
      data-testid="thinking-timeline"
    >
      <div className="absolute -left-4 bottom-2 top-2 w-0.5 bg-[var(--kp-brand-light)]/40" />
      <div className="min-w-0 space-y-3">
        {visibleSteps.map((step, i) => {
          const key =
            step.type === "tool"
              ? step.toolCallId
              : step.type === "progress"
                ? `progress-${step.jobId}`
                : step.type === "content"
                  ? `content-${step.round}-${i}`
                  : `thinking-${step.round}-${i}`;
          // 圆点仅给 thinking；content / tool 共享竖线但不画圆点（对标 Kimi Code）
          return (
            <div key={key} className="relative">
              {step.type === "thinking" && (
                <span className="absolute -left-5 top-2 h-2.5 w-2.5 rounded-full bg-[var(--kp-brand)] ring-2 ring-[var(--kp-bg-alt)]" />
              )}
              {step.type === "thinking" ? (
                <ThinkingStep step={step} isLive={isLive && i === visibleSteps.length - 1} />
              ) : step.type === "content" ? (
                <ContentStep step={step} />
              ) : step.type === "progress" ? (
                <ProgressStep step={step} isLive={isLive} />
              ) : (
                <ToolStep step={step} isLive={isLive} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
