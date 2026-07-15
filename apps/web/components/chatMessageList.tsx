"use client";

/**
 * ChatMessageList —— 消息列表渲染（W13a 从 chat.tsx 拆出）。
 * 包含消息组（用户气泡 + 思考时间线/中间步骤 + assistant 气泡 / 原位流式块）、
 * 乐观气泡、尾部流式块、虚拟列表与右侧导航条、空态/加载态。
 * 纯渲染：数据与回调全部经 props 传入；INV-1~8 流式状态机逻辑仍留在 chat.tsx。
 *
 * W16b：React.memo——流式期本组件必须随 token 重渲染（streamingContent 是 prop，
 * memo 不拦截）；屏障价值在非流式的 ChatView 重渲染（toast / 重命名输入等）
 * 不再连带整棵消息列表。前提是 chat.tsx 的 messageListProps 已 useMemo 打包、
 * 回调全部 useCallback 稳定。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Ban, Bot, Check, Loader2, X } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  buildTimelineFromStored,
  getActiveVersion,
  type MessageGroup,
  type TimelineStep,
} from "@/lib/chatMessageUtils";
import { LucideIconByName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { type ChatImageAttachment, type ChatMessage } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import { MessageActions, MessageSourceLabel, MessageVersions } from "@/components/chatMessageBits";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";
import { type OptimisticUserBubble } from "@/lib/useSessionComposeState";

export interface ChatMessageListProps {
  messageGroups: MessageGroup[];
  messages: ChatMessage[];
  optimistic: OptimisticUserBubble[];
  liveTimeline: TimelineStep[];
  streamingContent: string;
  isStreaming: boolean;
  streamTargetUserId: string | null;
  inFlightAssistantId: string | null;
  isSubagentSession: boolean;
  copiedId: string | null;
  editingUserId: string | null;
  editDraft: string;
  isMessagesHydrated: boolean;
  effectiveSessionId: string | null;
  backendDown: boolean;
  hasWorkspaces: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  onCopy: (id: string, content: string) => void;
  onShare: (content: string) => void;
  onRegenerate: (userMessageId: string) => void;
  onSwitchVersion: (assistantMessageId: string, versionIndex: number) => void;
  onEditConfirm: (userMessageId: string) => void;
  onRetry: (messageId: string) => void;
  setEditingUserId: (id: string | null) => void;
  setEditDraft: (draft: string) => void;
}

export const ChatMessageList = memo(function ChatMessageList({
  messageGroups,
  messages,
  optimistic,
  liveTimeline,
  streamingContent,
  isStreaming,
  streamTargetUserId,
  inFlightAssistantId,
  isSubagentSession,
  copiedId,
  editingUserId,
  editDraft,
  isMessagesHydrated,
  effectiveSessionId,
  backendDown,
  hasWorkspaces,
  hasOlderMessages,
  isLoadingOlderMessages,
  loadOlderMessages,
  onCopy: handleCopy,
  onShare: handleShare,
  onRegenerate: handleRegenerate,
  onSwitchVersion: handleSwitchVersion,
  onEditConfirm: handleEditConfirm,
  onRetry: handleRetry,
  setEditingUserId,
  setEditDraft,
}: ChatMessageListProps) {
  // #12 Swarm 新手引导（可关闭，localStorage 记忆）
  // 初始恒为 false，mount 后再读 localStorage，避免 SSR/首屏 hydration 不一致
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    // mount 后读 localStorage 同步到 React state（SSR 安全），非派生数据。
    // 故意在 effect 里 setState；react-hooks/set-state-in-effect（v6 编译器规则）
    // 不分析 memo 组件，原 eslint-disable 已随 W16b memo 化移除——若将来摘掉
    // memo，该规则报错时再把 disable 加回来。
    try {
      if (localStorage.getItem("kp-swarm-onboarding-dismissed") !== "1") {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
  }, []);
  const dismissSwarmOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem("kp-swarm-onboarding-dismissed", "1");
    } catch {
      // ignore
    }
  };

  // 虚拟列表句柄：用于导航条按索引滚动 + 结构变化时强制滚到底部
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // 右侧导航条：每条 assistant 回复一个横杠，hover 放大 + 预览，点击滚动定位
  const navItems = useMemo<NavItem[]>(() => {
    return messageGroups
      .map((g, idx) => {
        if (!g.assistantMessage) return null;
        const active = getActiveVersion(g);
        if (!active) return null;
        const preview = active.content.replace(/[#*`>\-\[\]!]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
        return {
          id: g.assistantMessage.id,
          preview: preview || "（空回复）",
          domId: g.assistantMessage.id,
          // 记录在 messageGroups 中的索引，供虚拟列表 scrollToIndex 使用
          index: idx,
        } satisfies NavItem;
      })
      .filter((x): x is NavItem => x !== null);
  }, [messageGroups]);

  useEffect(() => {
    // 仅在会话结构变化时滚动到底部；token 逐字更新由 Virtuoso followOutput 处理（避免视觉抖动）
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, [messageGroups.length, optimistic.length, isStreaming]);

  const hasMessages = messageGroups.length > 0 || optimistic.length > 0 || isStreaming;
  const showLiveStream = isStreaming || liveTimeline.length > 0 || !!streamingContent;
  const lastGroupIndex = messageGroups.length - 1;

  const renderIntermediateSteps = (group: MessageGroup) => {
    const active = getActiveVersion(group);
    if (!active) return null;
    const steps = buildTimelineFromStored(active.toolCalls);
    if (!steps.length) return null;
    return (
      <div className="flex w-full justify-start">
        <ThinkingTimeline steps={steps} isLive={false} />
      </div>
    );
  };

  const renderAssistantBubble = (group: MessageGroup, isLastGroup: boolean) => {
    const active = getActiveVersion(group);
    if (!active || !group.assistantMessage) return null;
    const assistantId = group.assistantMessage.id;
    const isInterrupted = group.assistantMessage.finishReason === "aborted";

    return (
      <motion.div
        key={`a-${assistantId}`}
        initial={false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        data-testid="assistant-message-bubble"
        data-nav-id={assistantId}
        className="group/msg relative mb-6 ml-12 flex max-w-[88%] flex-col items-start gap-1"
      >
        <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
          <PostContent content={active.content} className="prose-sm max-w-none text-left" />
          {isInterrupted && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-600">
              <Ban className="h-3 w-3" />
              <span>已停止生成</span>
            </div>
          )}
        </div>

        <MessageActions
          onCopy={() => void handleCopy(assistantId, active.content)}
          onShare={() => void handleShare(active.content)}
          onRegenerate={() => handleRegenerate(group.userMessage.id)}
          showRegenerate={isLastGroup}
          showEdit={false}
          showRetry={false}
          disabled={isStreaming}
          copied={copiedId === assistantId}
          versionNav={
            group.versions.length > 1 ? (
              <MessageVersions
                current={group.activeVersionIndex}
                total={group.versions.length}
                onPrev={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex - 1)}
                onNext={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex + 1)}
              />
            ) : null
          }
        />
      </motion.div>
    );
  };

  // 流式渲染块：思考时间线 + 实时 assistant 气泡。重试/重生成/编辑时原位调用，
  // 新消息时在列表底部调用。
  const renderLiveStreamBlock = () => (
    <>
      {showLiveStream && liveTimeline.length > 0 && (
        <div className="flex w-full justify-start">
          <ThinkingTimeline steps={liveTimeline} isLive />
        </div>
      )}
      {showLiveStream && (
        <div className="flex w-full justify-start">
          <div
            className={cn(
              "group/msg ml-12 flex max-w-[88%] flex-col items-start gap-1",
              streamingContent ? "mb-6" : "mb-4",
            )}
            data-testid="streaming-assistant-bubble"
          >
            {streamingContent ? (
              <div className="min-h-[3rem] w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
                <PostContent content={streamingContent} className="prose-sm max-w-none text-left" />
              </div>
            ) : liveTimeline.length === 0 ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] px-4 py-2 text-xs text-[var(--kp-text-2)] shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-brand)]" />
                Thinking…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );

  // 单个消息组渲染（用户气泡 + 思考时间线/中间步骤 + assistant 气泡 或 原位流式块）
  // 提取为函数供虚拟列表 itemContent 调用，仅可见项会执行。
  const renderMessageGroup = (group: MessageGroup, groupIdx: number) => {
    const isLastUser = groupIdx === lastGroupIndex;
    const isEditing = editingUserId === group.userMessage.id;
    const msgSource = (group.userMessage as { source?: string }).source ?? "user";
    const msgToolResults = (group.userMessage as { toolResults?: unknown }).toolResults;
    const subResult = (msgToolResults as {
      subagentResult?: {
        subagentName?: string;
        sourceType?: string;
        taskLabel?: string;
      };
    } | undefined)?.subagentResult;
    const subagentName = msgSource === "sub" ? subResult?.subagentName : undefined;
    // #24 子代理会话中，父 Agent 下发的任务消息视觉上像用户消息（右侧）。
    // source 可能是 super / manager（取决于父 Agent tier）。
    const isParentAgentTask =
      isSubagentSession && (msgSource === "super" || msgSource === "manager");
    // 异步结果投递：右侧气泡 + async sleep / async task 角标
    const isAsyncResultDelivery = msgSource === "sub" && !!subResult;
    // 心跳触发：放右侧（通知位），气泡内文字仍左对齐；视觉用灰底+橙标，不走 brand 用户色
    const isHeartbeat = msgSource === "system";
    const isRightSide = isHeartbeat
      || (isSubagentSession
        ? msgSource === "user" || isParentAgentTask || isAsyncResultDelivery
        : msgSource === "user" || msgSource === "sub" || isParentAgentTask);
    const isAgentMessage = !isRightSide;
    return (
      <div className="flex flex-col">
        <div className={cn("flex w-full", isRightSide ? "justify-end" : "justify-start")}>
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            data-testid="user-message-bubble"
            className={cn(
              "group/msg relative mb-3 flex flex-col gap-1",
              // 异步投递 / 父 Agent 任务含 markdown 表格，需更宽
              isAsyncResultDelivery || isParentAgentTask ? "max-w-[92%]" : "max-w-[70%]",
              isRightSide ? "items-end self-end" : "items-start self-start",
            )}
          >
            {group.userMessage.attachments && group.userMessage.attachments.length > 0 && !isEditing && (
              <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                {group.userMessage.attachments.map((att) => (
                  <div
                    key={att.previewUrl}
                    className="relative overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] shadow-sm"
                    title={att.extractedText ? `OCR 识别 · ${att.extractedText.slice(0, 120)}` : att.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      loading="lazy"
                      className="max-h-40 max-w-[min(100%,16rem)] object-contain"
                    />
                    {att.source === "ocr" && att.extractedText && (
                      <span className="absolute bottom-0 left-0 right-0 inline-flex items-center gap-0.5 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                        OCR <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className={cn(
              "relative w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl px-4 py-3 text-left text-sm shadow-sm",
              isHeartbeat || isAgentMessage
                ? "bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] border border-[var(--kp-divider)]"
                : isAsyncResultDelivery
                  // 子 Agent 返回结果：比正常用户气泡（--kp-brand-deep）略微深一点点（--kp-brand-darker），均达 AA
                  ? "bg-[var(--kp-brand-darker)] text-white"
                  : "bg-[var(--kp-brand-deep)] text-white",
            )}>
              <MessageSourceLabel
                source={msgSource}
                isSubagentSession={isSubagentSession}
                align={isRightSide ? "right" : "left"}
                subagentName={subagentName}
                asyncKind={isAsyncResultDelivery ? subResult?.sourceType : undefined}
                taskLabel={isAsyncResultDelivery ? subResult?.taskLabel : undefined}
              />
              {group.userMessage.skillName && (
                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                  <LucideIconByName name={group.userMessage.skillIcon} className="h-3 w-3" />
                  {group.userMessage.skillName}
                </span>
              )}
              {isEditing ? (
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={Math.max(1, editDraft.split("\n").length)}
                  className="block w-full resize-none border-0 bg-transparent p-0 text-left text-sm leading-relaxed text-white outline-none placeholder:text-white/50 [field-sizing:content]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleEditConfirm(group.userMessage.id);
                    }
                    if (e.key === "Escape") setEditingUserId(null);
                  }}
                />
              ) : isAsyncResultDelivery || isParentAgentTask ? (
                // 子 Agent 异步投递 / 父 Agent 下发任务：内容是 markdown（报告、表格、列表），用 PostContent 渲染
                // 气泡底色与正常用户气泡一致（bg-brand + text-white），prose-invert 让 markdown 文字/边框在深色背景上可读
                <PostContent
                  content={group.userMessage.content}
                  className="prose-sm prose-invert max-w-none text-left [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_a]:text-white [&_strong]:text-white [&_code]:bg-white/15 [&_pre]:bg-white/10 [&_blockquote]:border-white/40 [&_blockquote]:text-white/80"
                />
              ) : (
                <p className="whitespace-pre-wrap text-left leading-relaxed">{group.userMessage.content}</p>
              )}
            </div>
            <MessageActions
              onCopy={() => void handleCopy(group.userMessage.id, isEditing ? editDraft : group.userMessage.content)}
              onShare={() => void handleShare(isEditing ? editDraft : group.userMessage.content)}
              onEdit={() => {
                setEditingUserId(group.userMessage.id);
                setEditDraft(group.userMessage.content);
              }}
              onEditSave={() => handleEditConfirm(group.userMessage.id)}
              onEditCancel={() => setEditingUserId(null)}
              onRetry={() => handleRetry(group.userMessage.id)}
              showEdit={isLastUser && !isHeartbeat}
              showRetry={isLastUser && !isEditing && !isHeartbeat}
              showRegenerate={false}
              isEditing={isEditing}
              disabled={isStreaming}
              copied={copiedId === group.userMessage.id}
            />
          </motion.div>
        </div>
        {(isStreaming && streamTargetUserId === group.userMessage.id) ||
        (!!group.assistantMessage && group.assistantMessage.id === inFlightAssistantId)
          ? // INV-4：本轮流式的组（重试原位 / assistant 提前 upsert）由 live 块独占渲染，
            // stored timeline+气泡在 commit 前不渲染 → live→stored 在同一列表项内原子切换，无双渲染闪烁
            renderLiveStreamBlock()
          : (
              <>
                {renderIntermediateSteps(group)}
                <div className="flex w-full justify-start">
                  {renderAssistantBubble(group, isLastUser)}
                </div>
              </>
            )}
      </div>
    );
  };

  // 乐观消息渲染（用户发送后、流式落地前的占位气泡）
  const renderOptimisticMessage = (msg: { id: string; content: string; attachments?: ChatImageAttachment[] }) => (
    <div className="mb-4 flex justify-end">
      <div className="flex max-w-[70%] flex-col items-end gap-1.5">
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {msg.attachments.map((att) => (
              <div
                key={att.previewUrl}
                className="relative overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  loading="lazy"
                  className="max-h-40 max-w-[min(100%,16rem)] object-contain opacity-80"
                />
                {att.source === "ocr" && att.extractedText && (
                  <span className="absolute bottom-0 left-0 right-0 inline-flex items-center gap-0.5 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                    OCR <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl bg-[var(--kp-brand-deep)] px-4 py-3 text-sm text-white opacity-80">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    </div>
  );

  // 统一虚拟列表数据：消息组 + 乐观消息 + 尾部流式块（仅 !streamTargetUserId 时）
  type ChatItem =
    | { kind: "group"; key: string; group: MessageGroup; index: number }
    | { kind: "optimistic"; key: string; msg: { id: string; content: string; attachments?: ChatImageAttachment[]; createdAt?: number } }
    | { kind: "live"; key: "live-trailing" };
  // 后端已持久化的用户消息如果带有 clientMessageId，则隐藏对应的乐观气泡，避免重复显示。
  const materializedClientIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      const cid = (m as { toolResults?: { clientMessageId?: string } | null }).toolResults?.clientMessageId;
      if (cid) set.add(cid);
    }
    return set;
  }, [messages]);
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = messageGroups.map((group, index) => ({
      kind: "group",
      key: group.userMessage.id,
      group,
      index,
    }));
    for (const msg of optimistic) {
      if (materializedClientIds.has(msg.id)) continue;
      items.push({ kind: "optimistic", key: msg.id, msg });
    }
    // INV-4：in-flight assistant 已物化进组（live 块在组内原位渲染）时，不再渲染尾部 live 项
    const inFlightMaterialized =
      !!inFlightAssistantId &&
      messageGroups.some((g) => g.assistantMessage?.id === inFlightAssistantId);
    if (showLiveStream && !streamTargetUserId && !inFlightMaterialized) {
      items.push({ kind: "live", key: "live-trailing" });
    }
    return items;
  }, [messageGroups, optimistic, showLiveStream, streamTargetUserId, materializedClientIds, inFlightAssistantId]);

  const handleNavScrollToIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1">
      {!isMessagesHydrated && !!effectiveSessionId && !hasMessages ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-text-3)]" />
        </div>
      ) : !hasMessages && !backendDown ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4 text-center text-[var(--kp-text-3)] md:px-6">
          <Bot className="mb-1 h-12 w-12 opacity-40" />
          <p className="text-sm">发送第一条消息开始对话</p>
          {/* #12 Swarm 新手引导：无 Workspace 时展示（可关闭，localStorage 记忆） */}
          {!hasWorkspaces && showOnboarding && (
            <div className="relative max-w-md rounded-2xl border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)] p-4 text-left" data-testid="swarm-onboarding">
              <button
                type="button"
                onClick={dismissSwarmOnboarding}
                className="absolute right-2 top-2 rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                aria-label="关闭引导"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <p className="mb-1.5 text-xs font-semibold text-[var(--kp-text-1)]">试试 Agent Swarm</p>
              <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--kp-text-2)]">
                <li>· 右上角选择「KnowPilot 超级 Agent」，让它替你管理其他 Agent</li>
                <li>· 对它说「创建一个 XX 工作区」，它会自动生成管理 Agent</li>
                <li>· 也可以在 <Link href="/workspaces" className="text-[var(--kp-brand-deep)] underline">工作区管理页</Link> 手动创建</li>
                <li>· 长任务会派生子 Agent 后台执行，完成后结果自动回到对话</li>
              </ul>
            </div>
          )}
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="flex-1 min-h-0"
          data={chatItems}
          computeItemKey={(_, item) => item.key}
          itemContent={(_, item) => (
            <div className="px-4 py-1 md:px-6">
              {item.kind === "group" && renderMessageGroup(item.group, item.index)}
              {item.kind === "optimistic" && renderOptimisticMessage(item.msg)}
              {item.kind === "live" && renderLiveStreamBlock()}
            </div>
          )}
          components={{
            // 顶部加载更早时显示细条 spinner（无按钮，滚到顶部自动触发，见 startReached）
            Header: () =>
              isLoadingOlderMessages ? (
                <div className="flex justify-center py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-text-3)]" />
                </div>
              ) : (
                <div className="h-2" />
              ),
            Footer: () => <div className="h-4" />,
          }}
          followOutput={(atBottom) => (atBottom ? "auto" : false)}
          increaseViewportBy={{ top: 600, bottom: 600 }}
          // P0-1：滚到顶部自动 fetchNextPage 加载更早消息（业界标准 infinite-up-scroll，无按钮）；
          // Virtuoso 按 computeItemKey 稳定 id 在 prepend 时自动保持滚动位置。
          startReached={() => {
            if (hasOlderMessages && !isLoadingOlderMessages) {
              void loadOlderMessages();
            }
          }}
        />
      )}
      <MessageNavRail items={navItems} onScrollToIndex={handleNavScrollToIndex} />
    </div>
  );
});
