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

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Bot, Check, ChevronDown, Loader2, X } from "lucide-react";
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
import { StreamingPlainContent } from "@/components/streamingPlainContent";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import { MessageActions, MessageSourceLabel, MessageVersions } from "@/components/chatMessageBits";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";
import { type OptimisticUserBubble } from "@/lib/useSessionComposeState";
import { registerDeliveryLocateHandler } from "@/lib/deliveryLocate";

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
  /** 运行栏定位投递气泡时短暂高亮 */
  const [highlightJobId, setHighlightJobId] = useState<string | null>(null);
  /** 右侧导航：当前视口对应的回复横杠下标 */
  const [navActiveIdx, setNavActiveIdx] = useState<number | null>(null);
  /** Virtuoso atBottom 状态：离开底部时显示「回到底部」按钮，回底后隐藏 */
  const [isAtBottom, setIsAtBottom] = useState(true);
  /** 点击导航后短暂钉住高亮，避免 Virtuoso 估算滚动未到位时 rangeChanged 抢回上一轮 */
  const navPinUntilRef = useRef(0);
  useEffect(() => {
    setNavActiveIdx(null);
    navPinUntilRef.current = 0;
  }, [effectiveSessionId]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 流式续写交给 followOutput；切会话落底见下方 useLayoutEffect（禁止 Virtuoso key remount）。
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
      <div
        key={`a-${assistantId}`}
        data-testid="assistant-message-bubble"
        className="group/msg relative mb-6 flex w-full flex-col items-start gap-1"
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
      </div>
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
              "group/msg flex w-full flex-col items-start gap-1",
              streamingContent ? "mb-6" : "mb-4",
            )}
            data-testid="streaming-assistant-bubble"
          >
            {streamingContent ? (
              <div className="min-h-[3rem] w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
                {/* 流式期轻量渲染；落库后的 assistant 气泡仍走完整 PostContent */}
                <StreamingPlainContent
                  content={streamingContent}
                  className="prose-sm max-w-none text-left"
                />
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
        jobId?: string;
        subagentName?: string;
        sourceType?: string;
        taskLabel?: string;
      };
    } | undefined)?.subagentResult;
    const childNotify = (msgToolResults as {
      childNotify?: { sourceName?: string; source?: string };
    } | undefined)?.childNotify;
    const subagentName = msgSource === "sub" ? subResult?.subagentName : undefined;
    // #24 子代理会话中，父 Agent 下发的任务消息视觉上像用户消息（右侧）。
    // source 可能是 super / manager（取决于父 Agent tier）。
    const isParentAgentTask =
      isSubagentSession && (msgSource === "super" || msgSource === "manager");
    // 异步结果投递：右侧气泡 + async sleep / async task 角标
    const isAsyncResultDelivery = msgSource === "sub" && !!subResult;
    const deliveryJobId = isAsyncResultDelivery ? subResult?.jobId : undefined;
    // 子 Agent 主动通知父会话（agent_notify_parent）
    const isChildNotify = !!childNotify;
    // 心跳触发：放右侧（通知位），气泡内文字仍左对齐；视觉用灰底+橙标，不走 brand 用户色
    const isHeartbeat = msgSource === "system";
    const isRightSide = isHeartbeat || isChildNotify
      || (isSubagentSession
        ? msgSource === "user" || isParentAgentTask || isAsyncResultDelivery
        : msgSource === "user" || msgSource === "sub" || isParentAgentTask);
    return (
      <div className="flex flex-col">
        <div className={cn("flex w-full", isRightSide ? "justify-end" : "justify-start")}>
          <div
            data-testid="user-message-bubble"
            data-nav-id={group.userMessage.id}
            data-delivery-job-id={deliveryJobId || undefined}
            className={cn(
              // 默认接近全宽（对标 Kimi Code）；右对齐消息仍靠右，但内容区拉宽
              "group/msg relative mb-3 flex w-full flex-col gap-1",
              isRightSide ? "items-stretch self-end" : "items-stretch self-start",
              deliveryJobId &&
                highlightJobId === deliveryJobId &&
                "rounded-2xl ring-2 ring-[var(--kp-brand)] ring-offset-2 ring-offset-[var(--kp-bg)]",
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
            <div
              className={cn(
                "relative w-full min-w-[min(100%,6rem)] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm",
                deliveryJobId &&
                  highlightJobId === deliveryJobId &&
                  "border-[var(--kp-brand)]/50 bg-[var(--kp-brand-soft)]/30",
              )}
            >
              <MessageSourceLabel
                source={msgSource}
                isSubagentSession={isSubagentSession}
                align={isRightSide ? "right" : "left"}
                subagentName={subagentName}
                asyncKind={isAsyncResultDelivery ? subResult?.sourceType : undefined}
                taskLabel={isAsyncResultDelivery ? subResult?.taskLabel : undefined}
                childNotify={childNotify}
              />
              {group.userMessage.skillName && (
                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.5 text-[10px] text-[var(--kp-brand-deep)]">
                  <LucideIconByName name={group.userMessage.skillIcon} className="h-3 w-3" />
                  {group.userMessage.skillName}
                </span>
              )}
              {isEditing ? (
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={Math.max(1, editDraft.split("\n").length)}
                  className="block w-full resize-none border-0 bg-transparent p-0 text-left text-sm leading-relaxed text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)] [field-sizing:content]"
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
                // 子 Agent 异步投递 / 父 Agent 下发任务：markdown 报告（浅底气泡，普通 prose）
                <PostContent
                  content={group.userMessage.content}
                  className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
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
          </div>
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
      <div className="flex w-full flex-col items-stretch gap-1.5">
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
        <div className="w-full min-w-[min(100%,6rem)] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-4 py-3 text-sm text-[var(--kp-text-1)] opacity-80">
          <p className="whitespace-pre-wrap text-left">{msg.content}</p>
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

  // 右侧导航：锚点 = 用户发送的消息（对标 DeepSeek 大纲），不是 assistant 回复
  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [];
    chatItems.forEach((item, virtuosoIdx) => {
      if (item.kind !== "group") return;
      const userMsg = item.group.userMessage;
      const preview = (userMsg.content || "")
        .replace(/[#*`>\-\[\]!()]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const total = item.group.versions.length;
      items.push({
        id: userMsg.id,
        preview: preview || "（空消息）",
        domId: userMsg.id,
        index: virtuosoIdx,
        versionLabel: total > 1 ? `${item.group.activeVersionIndex + 1}/${total}` : undefined,
      });
    });
    return items;
  }, [chatItems]);

  // 冷加载：当前 session 尚未就绪时保留上一屏（禁止用「上一会话的 hydrated=true」冲掉 hold）
  const holdRef = useRef<{ sessionId: string | null; items: ChatItem[] }>({
    sessionId: effectiveSessionId,
    items: [],
  });
  const sessionReady =
    !effectiveSessionId ||
    isMessagesHydrated ||
    chatItems.length > 0 ||
    isStreaming ||
    optimistic.length > 0;
  const isColdLoading = !!effectiveSessionId && !sessionReady;
  if (sessionReady) {
    holdRef.current = { sessionId: effectiveSessionId, items: chatItems };
  }
  const showingStale = isColdLoading && holdRef.current.items.length > 0;
  const displayItems = showingStale ? holdRef.current.items : chatItems;
  const hasDisplay = displayItems.length > 0;

  const handleNavNavigate = useCallback((navIdx: number, item: NavItem) => {
    setNavActiveIdx(navIdx);
    navPinUntilRef.current = Date.now() + 1200;
    // 先让 Virtuoso 把目标项滚进窗口（高度估算可能偏短）
    virtuosoRef.current?.scrollToIndex({
      index: item.index,
      align: "start",
      behavior: "smooth",
    });
    // 再按真实 DOM 精确定位（对标 DeepSeek：点第 N 轮就停在第 N 轮）
    window.setTimeout(() => {
      const el = document.querySelector(
        `[data-nav-id="${CSS.escape(item.domId)}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        // 目标尚未挂载：再催一次 Virtuoso
        virtuosoRef.current?.scrollToIndex({
          index: item.index,
          align: "start",
          behavior: "auto",
        });
        window.setTimeout(() => {
          document
            .querySelector(`[data-nav-id="${CSS.escape(item.domId)}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    }, 60);
  }, []);

  // 切会话落底：不 remount Virtuoso（禁止 key=sessionId 白屏），只在会话真正就绪后 scroll
  const scrolledForSidRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (showingStale) return;
    const sid = effectiveSessionId ?? "new";
    if (scrolledForSidRef.current === sid) return;
    if (chatItems.length === 0) {
      if (isMessagesHydrated || !effectiveSessionId) scrolledForSidRef.current = sid;
      return;
    }
    virtuosoRef.current?.scrollToIndex({
      index: chatItems.length - 1,
      align: "end",
      behavior: "auto",
    });
    scrolledForSidRef.current = sid;
  }, [effectiveSessionId, showingStale, isMessagesHydrated, chatItems.length]);

  // 运行栏「已消费」卡片 → 滚动到带 toolResults.subagentResult.jobId 的投递气泡
  useEffect(() => {
    return registerDeliveryLocateHandler((jobId) => {
      const listIndex = displayItems.findIndex((item) => {
        if (item.kind !== "group") return false;
        const tr = (item.group.userMessage as { toolResults?: { subagentResult?: { jobId?: string } } })
          .toolResults;
        return tr?.subagentResult?.jobId === jobId;
      });
      if (listIndex < 0) return false;
      virtuosoRef.current?.scrollToIndex({ index: listIndex, align: "center", behavior: "smooth" });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightJobId(jobId);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightJobId(null);
        highlightTimerRef.current = null;
      }, 2200);
      return true;
    });
  }, [displayItems]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1">
      {!hasDisplay && isColdLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-text-3)]" />
        </div>
      ) : !hasDisplay && !backendDown ? (
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
        <>
          <Virtuoso
            ref={virtuosoRef}
            className={cn("flex-1 min-h-0", showingStale && "opacity-60")}
            data={displayItems}
            // 仅首次挂载落底；切会话改走上面的 useLayoutEffect，避免 key remount 白屏
            initialTopMostItemIndex={
              displayItems.length > 0
                ? { index: displayItems.length - 1, align: "end" }
                : 0
            }
            computeItemKey={(_, item) => item.key}
            itemContent={(_, item) => (
              <div className="py-1 pl-4 pr-9 md:pl-6 md:pr-12">
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
            atBottomStateChange={setIsAtBottom}
            rangeChanged={(range) => {
              if (navItems.length === 0) return;
              // 点击导航钉住期间不跟滚，防止估算高度导致高亮退回上一轮
              if (Date.now() < navPinUntilRef.current) return;
              // 对标 DeepSeek：取「视口顶部附近」那一轮（最后一个 index <= startIndex 的 nav）
              let best = 0;
              for (let i = 0; i < navItems.length; i++) {
                if (navItems[i]!.index <= range.startIndex) best = i;
                else break;
              }
              // 若顶部还没到第一条有回复的组，但视口已覆盖某条，取视口内第一条
              if (navItems[0]!.index > range.startIndex) {
                for (let i = 0; i < navItems.length; i++) {
                  const ni = navItems[i]!.index;
                  if (ni >= range.startIndex && ni <= range.endIndex) {
                    best = i;
                    break;
                  }
                }
              }
              setNavActiveIdx((prev) => (prev === best ? prev : best));
            }}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            // P0-1：滚到顶部自动 fetchNextPage 加载更早消息（业界标准 infinite-up-scroll，无按钮）；
            // Virtuoso 按 computeItemKey 稳定 id 在 prepend 时自动保持滚动位置。
            startReached={() => {
              if (showingStale) return;
              if (hasOlderMessages && !isLoadingOlderMessages) {
                void loadOlderMessages();
              }
            }}
          />
          {showingStale && (
            <div
              className="pointer-events-none absolute inset-0 flex items-start justify-center pt-6"
              aria-hidden
            >
              <Loader2 className="h-5 w-5 animate-spin text-[var(--kp-text-3)]" />
            </div>
          )}
        </>
      )}
      {/* 回到底部：仅离开底部时出现，回底后自动隐藏（对标 Kimi Code 右下角浮钮） */}
      {hasDisplay && !isAtBottom && (
        <button
          type="button"
          data-testid="scroll-to-bottom"
          aria-label="回到底部"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({
              index: displayItems.length - 1,
              align: "end",
              behavior: "smooth",
            })
          }
          className="absolute bottom-5 right-12 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] text-[var(--kp-text-2)] shadow-md transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      <MessageNavRail
        items={showingStale ? [] : navItems}
        activeIndex={navActiveIdx}
        onNavigate={handleNavNavigate}
      />
    </div>
  );
});
