"use client";

import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Gauge, X } from "lucide-react";
import type { ChatMessage } from "@knowpilot/shared";
import { buildContextUsage, formatTokenCount, type ContextUsageSnapshot } from "@/lib/contextUsage";
import { cn } from "@/lib/utils";

// R15：memo 化——流式时 messages（无限查询，流式期间稳定）与 systemPrompt 稳定，跳过重渲染
export const SessionContextBar = memo(function SessionContextBar({
  messages,
  systemPrompt,
  className,
}: {
  messages: ChatMessage[];
  systemPrompt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const usage = buildContextUsage({ messages, systemPrompt });
  const pct = Math.round(usage.ratio * 100);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelWidth = 320;
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
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center divide-x divide-[var(--kp-divider)] overflow-hidden rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] text-[11px] tabular-nums text-[var(--kp-text-2)] shadow-sm transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="session-context-pill"
        >
          <span className="flex items-center gap-1 px-2.5 py-1">
            <Gauge className="h-3 w-3 text-[var(--kp-brand)]" />
            {pct}%
          </span>
          <span className="flex items-center gap-1 px-2.5 py-1">
            <ArrowUp className="h-3 w-3 text-[var(--kp-text-3)]" />
            {formatTokenCount(usage.inputTokens)}
          </span>
          <span className="flex items-center gap-1 px-2.5 py-1">
            <ArrowDown className="h-3 w-3 text-[var(--kp-text-3)]" />
            {formatTokenCount(usage.outputTokens)}
          </span>
        </button>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ContextUsagePopover
            ref={panelRef}
            usage={usage}
            style={{ top: pos.top, left: pos.left }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
});

const ContextUsagePopover = forwardRef<
  HTMLDivElement,
  {
    usage: ContextUsageSnapshot;
    style: { top: number; left: number };
    onClose: () => void;
  }
>(function ContextUsagePopover({ usage, style, onClose }, ref) {
  const pct = Math.round(usage.ratio * 100);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="上下文占用"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "fixed", top: style.top, left: style.left, zIndex: 9999 }}
      className="w-80 overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-xl shadow-[rgba(45,42,38,0.1)]"
      data-testid="context-usage-popover"
    >
      <div className="flex items-center justify-between border-b border-[var(--kp-divider-light)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">上下文占用</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-[var(--kp-text-1)]">{pct}% 已满</span>
          <span className="text-[var(--kp-text-3)]">
            ~{formatTokenCount(usage.estimatedTotal)} / {formatTokenCount(usage.maxContextTokens)} tokens
          </span>
        </div>

        <SegmentedBar segments={usage.segments} total={usage.estimatedTotal} />

        <ul className="space-y-0.5">
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

        <p className="text-[10px] leading-relaxed text-[var(--kp-text-3)]">
          输入/输出为 API 累计用量；上下文分段按字符粗算（÷4）。超过阈值时服务端自动摘要旧消息。
        </p>
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
