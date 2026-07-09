"use client";

/**
 * Chat 时间线子组件——从 chat.tsx 拆出。
 * 包含 Thinking / Content / Tool 三类 step 与 ThinkingTimeline 容器。
 * 纯展示型，无外部状态依赖，可独立 memo / chunk。
 */

import { memo, useMemo, useState } from "react";
import { ChevronRight, Loader2, Sparkles, Wrench } from "lucide-react";
import { PostContent } from "@/components/post/PostContent";
import { cn } from "@/lib/utils";
import { formatToolResultHint, type TimelineStep } from "@/lib/chatMessageUtils";

const ThinkingStep = memo(function ThinkingStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "thinking" }>;
  isLive?: boolean;
}) {
  const content = step.content.trim();
  const isEmpty = !content;
  // 默认折叠（含流式）；用户可点击展开查看，流式中也可展开/折叠
  const [collapsed, setCollapsed] = useState(true);

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
          ) : (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--kp-text-2)]">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

/** 中间正式回复（工具轮次中 probe 返回的 content，后续仍有工具调用）。进导轨，无圆点，无气泡包裹。 */
const ContentStep = memo(function ContentStep({
  step,
}: {
  step: Extract<TimelineStep, { type: "content" }>;
}) {
  const content = step.content.trim();
  if (!content) return null;
  return (
    <div data-testid="intermediate-content-step" className="px-1 py-1 text-sm text-[var(--kp-text-1)]">
      <PostContent content={content} className="prose-sm max-w-none" />
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
  const displayName = step.name.replace(/^skill__/, "Skill · ").replace(/^mcp__/, "MCP · ");
  const hasError =
    step.result &&
    typeof step.result === "object" &&
    step.result !== null &&
    "error" in (step.result as Record<string, unknown>);

  // R18：JSON.stringify 仅在展开时计算（折叠时不浪费 CPU），且 memo 化避免重复 stringify
  const argsJson = useMemo(() => (open ? JSON.stringify(step.args, null, 2) : ""), [open, step.args]);
  const resultJson = useMemo(
    () => (open && step.result !== undefined ? JSON.stringify(step.result, null, 2) : ""),
    [open, step.result],
  );

  return (
    <div
      data-testid="tool-pill"
      className={cn(
        "overflow-hidden rounded-xl border shadow-sm transition-colors",
        step.status === "running"
          ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30"
          : "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
      )}
    >
      <details open={open} className="group/tool" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-[var(--kp-text-2)]">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              step.status === "running" ? "animate-pulse bg-[var(--kp-brand)]" : hasError ? "bg-red-500" : "bg-green-500",
            )}
          />
          <Wrench className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
          <span className="min-w-0 truncate">{displayName}</span>
          {step.status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--kp-brand)]" />}
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
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)]">
              {argsJson}
            </pre>
            {step.result !== undefined && (
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--kp-divider-light)] pt-2 text-[10px] text-[var(--kp-text-2)]">
                {resultJson}
              </pre>
            )}
          </div>
        )}
      </details>
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
  if (!steps.length) return null;

  return (
    <div className="mb-2 flex max-w-[88%] gap-0" data-testid="thinking-timeline">
      <div className="relative flex w-6 shrink-0 justify-center pt-2">
        <div className="absolute top-2 bottom-2 w-0.5 bg-[var(--kp-brand-light)]/40" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {steps.map((step, i) => {
          const key =
            step.type === "tool"
              ? step.toolCallId
              : step.type === "content"
                ? `content-${step.round}-${i}`
                : `thinking-${step.round}-${i}`;
          // 圆点仅给 thinking；content / tool 共享竖线但不画圆点（对标 Kimi Code）
          return (
            <div key={key} className="relative">
              {step.type === "thinking" && (
                <span className="absolute -left-[17px] top-2 h-2.5 w-2.5 rounded-full bg-[var(--kp-brand)] ring-2 ring-[var(--kp-bg-alt)]" />
              )}
              {step.type === "thinking" ? (
                <ThinkingStep step={step} isLive={isLive && i === steps.length - 1} />
              ) : step.type === "content" ? (
                <ContentStep step={step} />
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
