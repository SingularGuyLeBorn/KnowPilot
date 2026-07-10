"use client";

/**
 * ChatHoverMonitor — 左侧会话 hover 时右上角悬浮小窗口监控预览。
 *
 * 显示目标会话的元数据（标题、Agent、状态、最近更新时间）与最近几条消息缩略，
 * 让用户在不切会话的情况下快速扫一眼内容。点击窗口进入该会话。
 */

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ExternalLink, Loader2, MessageSquare, X } from "lucide-react";
import type { ChatMessage } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { cn, formatRelativeTime } from "@/lib/utils";
import { buildMessageGroups, type MessageGroup } from "@/lib/chatMessageUtils";
import { buttonVariants } from "@/components/ui/button";

interface ChatHoverMonitorProps {
  sessionId: string | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClose?: () => void;
}

const WINDOW_WIDTH = 384; // w-96
const WINDOW_MAX_HEIGHT = "70vh";

export function ChatHoverMonitor({ sessionId, onMouseEnter, onMouseLeave, onClose }: ChatHoverMonitorProps) {
  const ref = useRef<HTMLDivElement>(null);

  const sessionQuery = trpc.session.getById.useQuery({ id: sessionId! }, { enabled: !!sessionId });
  const messagesQuery = trpc.message.listForChat.useInfiniteQuery(
    { sessionId: sessionId!, limit: 8 },
    {
      enabled: !!sessionId,
      getNextPageParam: (last) => last.nextCursor,
      refetchOnMount: false,
      staleTime: 10_000,
    },
  );

  const messages = useMemo(
    () => ((messagesQuery.data?.pages ?? []).slice().reverse().flatMap((p) => p.items) as ChatMessage[]),
    [messagesQuery.data],
  );
  const groups = useMemo(() => buildMessageGroups(messages), [messages]);
  const session = sessionQuery.data;
  const isLoading = sessionQuery.isLoading || messagesQuery.isLoading;

  // 预加载：鼠标进入时由父组件触发 prefetch，组件挂载后也主动取一次第一页
  useEffect(() => {
    if (!sessionId) return;
    void messagesQuery.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ESC 关闭
  useEffect(() => {
    if (!sessionId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sessionId, onClose]);

  // 点击外部关闭（但 hover 到目标会话项时由父组件的 onMouseEnter 保持开启）
  useEffect(() => {
    if (!sessionId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target)) {
        onClose?.();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [sessionId, onClose]);

  if (!sessionId) return null;

  const messageCount = messages.length;

  return (
    <AnimatePresence>
      {sessionId && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, x: 20, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className={cn(
            "fixed right-4 top-20 z-50 flex flex-col overflow-hidden",
            "w-96 max-h-[70vh] rounded-2xl border border-[var(--kp-divider)]",
            "bg-[var(--kp-bg-alt)] shadow-2xl shadow-black/10",
          )}
          style={{ width: WINDOW_WIDTH, maxHeight: WINDOW_MAX_HEIGHT }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          data-testid="chat-hover-monitor"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
                <h3 className="truncate text-xs font-semibold text-[var(--kp-text-1)]">
                  {session?.title ?? "会话预览"}
                </h3>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--kp-text-3)]">
                <span className="truncate">{session?.model ?? "—"}</span>
                <StatusBadge status={session?.status ?? "active"} />
                {session?.updatedAt && <span>· {formatRelativeTime(session.updatedAt)}</span>}
              </div>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-0.5">
              <Link
                href={`/chat?sessionId=${sessionId}`}
                onClick={() => onClose?.()}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7")}
                title="进入对话"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => onClose?.()}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7")}
                aria-label="关闭预览"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--kp-text-3)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载中…
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--kp-text-3)]">
                <MessageSquare className="h-6 w-6 opacity-40" />
                <p className="text-xs">该会话暂无消息</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.slice(-5).map((group: MessageGroup) => {
                  const userText = toPlainPreview(group.userMessage.content, 120);
                  const assistant = group.versions?.[group.activeVersionIndex];
                  const assistantText = assistant?.content ? toPlainPreview(assistant.content, 180) : "";
                  return (
                    <div key={group.userMessage.id} className="space-y-1.5">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-xl bg-[var(--kp-brand)] px-2.5 py-1.5 text-[11px] text-white">
                          <p className="line-clamp-3 break-words">{userText}</p>
                        </div>
                      </div>
                      {assistantText && (
                        <div className="flex justify-start">
                          <div className="max-w-[90%] rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-[11px] text-[var(--kp-text-1)]">
                            <p className="line-clamp-4 break-words text-[var(--kp-text-2)]">{assistantText}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-3 py-2 text-[10px] text-[var(--kp-text-3)]">
            <span>
              {messageCount > 0 ? `共 ${messageCount} 条消息 · 展示最近 ${Math.min(groups.length, 5)} 轮` : "悬停会话监控"}
            </span>
            <span className="opacity-60">ESC / 点击外部关闭</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-green-500/10 text-green-600"
      : status === "queued"
        ? "bg-amber-500/10 text-amber-600"
        : status === "failed" || status === "paused"
          ? "bg-red-500/10 text-red-600"
          : "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]";
  const label: Record<string, string> = {
    running: "运行中",
    queued: "排队中",
    completed: "已完成",
    done: "已完成",
    failed: "失败",
    paused: "已暂停",
    active: "活跃",
  };
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", color)}>
      {label[status] ?? status}
    </span>
  );
}

/** 把 Markdown / HTML 片段快速压成纯文本预览，避免小窗口里渲染复杂格式。 */
function toPlainPreview(raw: string, maxLen: number): string {
  if (!raw) return "";
  const plain = raw
    .replace(/!\[.*?\]\(.*?\)/g, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "[代码块]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*#_\-\[\]>`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}
