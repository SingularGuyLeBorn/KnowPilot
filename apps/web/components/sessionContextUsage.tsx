"use client";

import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FileText, Gauge, X } from "lucide-react";
import type { ChatMessage } from "@knowpilot/shared";
import { buildContextUsage, formatTokenCount, type ContextUsageSnapshot } from "@/lib/contextUsage";
import { cn } from "@/lib/utils";

/**
 * 上下文占用：Header 与弹层只用「当前送模窗口」一个主百分比。
 * 累计 API ↑↓ 是各轮 prompt 叠乘账单，禁止与窗口占用并列误导。
 */
export const SessionContextBar = memo(function SessionContextBar({
  messages,
  systemPrompt,
  modelId,
  className,
  contextSummary,
  onCompact,
  compactPending,
  onOpenPromptEditor,
  onResetPrompt,
}: {
  messages: ChatMessage[];
  systemPrompt: string;
  modelId?: string;
  className?: string;
  contextSummary?: string | null;
  onCompact?: () => void;
  compactPending?: boolean;
  onOpenPromptEditor?: () => void;
  onResetPrompt?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const usage = buildContextUsage({ messages, systemPrompt, modelId, contextSummary });
  const windowPct = Math.round(usage.ratio * 100);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelWidth = 420;
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 12) {
      left = window.innerWidth - panelWidth - 12;
    }
    setPos({ top: rect.bottom + 8, left: Math.max(12, left) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <span className="hidden text-[11px] font-medium text-[var(--kp-text-3)] sm:inline">Session</span>
        {onOpenPromptEditor && (
          <button
            type="button"
            data-testid="chat-system-prompt-btn"
            onClick={onOpenPromptEditor}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-2.5 py-1 text-[11px] text-[var(--kp-text-2)] shadow-sm transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)] hover:text-[var(--kp-brand-deep)]"
            title="编辑系统提示"
          >
            <FileText className="h-3 w-3" />
            <span className="hidden sm:inline">系统提示</span>
          </button>
        )}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-2.5 py-1 text-[11px] tabular-nums text-[var(--kp-text-2)] shadow-sm transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
          aria-expanded={open}
          aria-haspopup="dialog"
          title={`当前送模窗口约 ${formatTokenCount(usage.estimatedTotal)} / ${formatTokenCount(usage.maxContextTokens)}（${windowPct}%）`}
          data-testid="session-context-pill"
        >
          <Gauge className="h-3 w-3 text-[var(--kp-brand)]" />
          <span className="font-medium text-[var(--kp-text-1)]">{windowPct}%</span>
          <span className="text-[var(--kp-text-3)]">
            ~{formatTokenCount(usage.estimatedTotal)}/{formatTokenCount(usage.maxContextTokens)}
          </span>
        </button>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ContextUsagePopover
            ref={panelRef}
            usage={usage}
            systemPrompt={systemPrompt}
            contextSummary={contextSummary}
            style={{ top: pos.top, left: pos.left }}
            onClose={() => setOpen(false)}
            onCompact={onCompact}
            compactPending={compactPending}
            onOpenPromptEditor={onOpenPromptEditor}
            onResetPrompt={onResetPrompt}
          />,
          document.body,
        )}
    </>
  );
});

function SummaryReveal({ summary }: { summary?: string | null }) {
  const [open, setOpen] = useState(false);
  const text = summary?.trim() || "";
  if (!text) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-[var(--kp-brand-deep)] hover:underline"
        data-testid="context-summary-reveal"
      >
        {open ? "收起摘要" : "查看完整摘要"}
      </button>
      {open ? (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-2 text-[11px] leading-relaxed text-[var(--kp-text-2)]">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

const ContextUsagePopover = forwardRef<
  HTMLDivElement,
  {
    usage: ContextUsageSnapshot;
    systemPrompt: string;
    contextSummary?: string | null;
    style: { top: number; left: number };
    onClose: () => void;
    onCompact?: () => void;
    compactPending?: boolean;
    onOpenPromptEditor?: () => void;
    onResetPrompt?: () => void;
  }
>(function ContextUsagePopover(
  {
    usage,
    systemPrompt,
    contextSummary,
    style,
    onClose,
    onCompact,
    compactPending,
    onOpenPromptEditor,
    onResetPrompt,
  },
  ref,
) {
  const windowPct = Math.round(usage.ratio * 100);
  const compactPct = Math.round(usage.compactRatio * 100);
  const compactThresholdTokens = Math.round(
    usage.maxContextTokens * usage.compactTriggerRatio,
  );
  const warn = usage.ratio >= usage.compactTriggerRatio * 0.9;
  const critical = usage.ratio >= usage.compactTriggerRatio;
  const ringColor = critical ? "#ef4444" : warn ? "#f59e0b" : "var(--kp-brand)";
  const promptPreview = systemPrompt.trim() || "（使用 Agent 默认提示）";

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="上下文占用报告"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "fixed", top: style.top, left: style.left, zIndex: 9999 }}
      className="overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-xl shadow-[rgba(45,42,38,0.12)]"
      data-testid="context-usage-popover"
    >
      <div className="w-[420px]">
        <div className="flex items-center justify-between border-b border-[var(--kp-divider-light)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">上下文占用报告</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
          {/* 唯一主环：当前送模窗口占模型上限 */}
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--kp-bg-mute)" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="3"
                  strokeDasharray={`${usage.ratio * 97.4} 97.4`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold tabular-nums text-[var(--kp-text-1)]">{windowPct}%</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs text-[var(--kp-text-3)]">当前送模窗口</div>
              <div className="text-sm font-semibold tabular-nums text-[var(--kp-text-1)]">
                ~{formatTokenCount(usage.estimatedTotal)} / {formatTokenCount(usage.maxContextTokens)}
              </div>
              <p className="text-[10px] leading-snug text-[var(--kp-text-3)]">
                摘要 + 最近压缩边界之后的消息（粗算 ÷4）。与顶栏百分比同一口径。
              </p>
            </div>
          </div>

          {/* 自动压缩：次要进度；完整摘要点击展开（不塞进对话正文） */}
          <div className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-medium text-[var(--kp-text-2)]">自动压缩进度</span>
              <span className="tabular-nums text-[var(--kp-text-3)]">
                {compactPct}% · 阈值 {Math.round(usage.compactTriggerRatio * 100)}% 窗口
                （~{formatTokenCount(compactThresholdTokens)}）
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
              <div
                className="h-full rounded-full bg-[var(--kp-brand)]/70 transition-[width]"
                style={{ width: `${Math.min(100, compactPct)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--kp-text-3)]">
              {usage.compression.hasAutoCompacted
                ? "已有上下文摘要。点下方展开，或在对话时间线的压缩卡片里查看——摘要不进气泡正文。"
                : compactPct >= 90
                  ? "接近自动压缩阈值，继续对话将摘要更早消息。"
                  : "未达自动压缩阈值。满阈值后服务端会摘要旧对话（不是把 1M 窗口「压」成更小上限）。"}
            </p>
            <SummaryReveal summary={contextSummary} />
          </div>

          <div>
            <SegmentedBar segments={usage.segments} total={usage.estimatedTotal} />
            <ul className="mt-2 space-y-0.5">
              {usage.segments.map((seg) => (
                <li
                  key={seg.id}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition hover:bg-[var(--kp-bg-mute)]/60"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
                    <span className="truncate text-[var(--kp-text-2)]">{seg.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--kp-text-1)]">
                    {formatTokenCount(seg.tokens)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 累计 API：与窗口占用物理分离 */}
          {(usage.inputTokens > 0 || usage.outputTokens > 0) && (
            <div
              className="rounded-xl border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-3 py-2.5"
              data-testid="context-api-lifetime"
            >
              <div className="mb-1 text-[11px] font-semibold text-[var(--kp-text-2)]">
                会话累计 API 用量（≠当前窗口）
              </div>
              <div className="flex gap-4 text-xs tabular-nums text-[var(--kp-text-1)]">
                <span>输入 {formatTokenCount(usage.inputTokens)}</span>
                <span>输出 {formatTokenCount(usage.outputTokens)}</span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                把每一轮请求的 prompt/completion 加总。历史越长，每轮 prompt 越大，累加可远超模型窗口（例如数百万），这不是「已经塞进 1M 上下文」，也不是压缩后的结果。
              </p>
            </div>
          )}

          {(onOpenPromptEditor || onResetPrompt) && (
            <div
              className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-3 py-2.5"
              data-testid="context-prompt-section"
            >
              <div className="mb-1.5 text-[11px] font-semibold text-[var(--kp-text-2)]">系统提示</div>
              <p className="max-h-20 overflow-y-auto text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                {promptPreview.length > 280 ? `${promptPreview.slice(0, 280)}…` : promptPreview}
              </p>
              <div className="mt-2 flex gap-2">
                {onOpenPromptEditor && (
                  <button
                    type="button"
                    data-testid="context-prompt-edit"
                    onClick={() => {
                      onClose();
                      onOpenPromptEditor();
                    }}
                    className="flex-1 rounded-lg bg-[var(--kp-brand)] px-2 py-1.5 text-xs font-medium text-white"
                  >
                    编辑
                  </button>
                )}
                {onResetPrompt && (
                  <button
                    type="button"
                    data-testid="context-prompt-reset"
                    onClick={onResetPrompt}
                    className="flex-1 rounded-lg border border-[var(--kp-divider)] px-2 py-1.5 text-xs text-[var(--kp-text-2)]"
                  >
                    重置
                  </button>
                )}
              </div>
            </div>
          )}

          {onCompact && (
            <button
              type="button"
              disabled={compactPending}
              onClick={() => onCompact()}
              className="w-full rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs font-medium text-[var(--kp-text-1)] transition hover:border-[var(--kp-brand)] hover:bg-[var(--kp-brand-soft)]/40 disabled:opacity-50"
              data-testid="manual-compact-button"
            >
              {compactPending ? "压缩中…" : "立即压缩上下文"}
            </button>
          )}

          {usage.topMessages.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                Top 消耗消息（按整轮，非单次工具）
              </div>
              <ul className="space-y-1">
                {usage.topMessages.map((msg, i) => (
                  <li
                    key={msg.id}
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11px] transition hover:bg-[var(--kp-bg-mute)]/60"
                  >
                    <span className="shrink-0 tabular-nums font-semibold text-[var(--kp-text-3)]">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
                            msg.role === "user"
                              ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                              : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]",
                          )}
                        >
                          {msg.role === "user" ? "用户" : msg.role === "assistant" ? "AI 整轮" : msg.role}
                        </span>
                        {msg.isSummarized && (
                          <span className="shrink-0 rounded bg-[var(--kp-brand-light)]/30 px-1 py-0.5 text-[9px] text-[var(--kp-brand-deep)]">
                            已压缩
                          </span>
                        )}
                        <span className="ml-auto shrink-0 tabular-nums font-medium text-[var(--kp-text-1)]">
                          ~{formatTokenCount(msg.tokens)}
                        </span>
                      </div>
                      {msg.breakdown && (msg.breakdown.toolCount > 0 || msg.breakdown.thinkingTokens > 0) && (
                        <p className="mt-0.5 text-[10px] tabular-nums text-[var(--kp-text-3)]">
                          {msg.breakdown.toolCount > 0
                            ? `${msg.breakdown.toolCount} 次工具 ~${formatTokenCount(msg.breakdown.toolsTokens)}`
                            : "无工具"}
                          {msg.breakdown.thinkingTokens > 0
                            ? ` · 思考 ~${formatTokenCount(msg.breakdown.thinkingTokens)}`
                            : ""}
                          {msg.breakdown.contentTokens > 0
                            ? ` · 正文 ~${formatTokenCount(msg.breakdown.contentTokens)}`
                            : ""}
                        </p>
                      )}
                      <p className="mt-0.5 truncate text-[10px] text-[var(--kp-text-3)]">{msg.preview}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

function SegmentedBar({
  segments,
  total,
}: {
  segments: ContextUsageSnapshot["segments"];
  total: number;
}) {
  if (total <= 0) {
    return <div className="h-2 rounded-full bg-[var(--kp-bg-mute)]" />;
  }
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
      {segments.map((seg) => (
        <div
          key={seg.id}
          style={{
            width: `${(seg.tokens / total) * 100}%`,
            backgroundColor: seg.color,
          }}
          title={seg.label}
        />
      ))}
    </div>
  );
}
