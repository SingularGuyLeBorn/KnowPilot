"use client";
import { catchUnlessCancelled } from "@/lib/trpc";

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
import { Ban, Bot, Check, ChevronDown, FileText, Loader2, X } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  buildTimelineFromStored,
  getActiveVersion,
  type MessageGroup,
  type TimelineStep,
} from "@/lib/chatMessageUtils";
import { LucideIconByName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  isChatImageAttachment,
  isChatPostAttachment,
  type ChatAttachment,
  type ChatMessage,
} from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { StreamingPlainContent } from "@/components/streamingPlainContent";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import {
  MessageActions,
  MessageMarkdownSourceEditor,
  MessageSourceLabel,
  MessageVersions,
} from "@/components/chatMessageBits";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";
import { type OptimisticUserBubble } from "@/lib/useSessionComposeState";
import { registerDeliveryLocateHandler } from "@/lib/deliveryLocate";
import { useSpeechSynthesis } from "@/lib/useSpeechSynthesis";
import { postDetailHref } from "@/lib/postHref";

function UserAttachmentChips({
  attachments,
  dimmed,
}: {
  attachments: ChatAttachment[];
  dimmed?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn("mb-1.5 flex flex-wrap justify-end gap-2", dimmed && "opacity-80")}>
      {attachments.map((att) => {
        if (isChatPostAttachment(att)) {
          return (
            <Link
              key={`post-${att.id}`}
              href={postDetailHref(att.slug, att.garden)}
              className="inline-flex max-w-[min(100%,18rem)] items-start gap-1.5 rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] px-2.5 py-1.5 text-left shadow-sm transition hover:border-[var(--kp-brand)]/40 hover:bg-[var(--kp-brand-soft)]/30"
              title={`${att.garden}/${att.slug}`}
              data-testid="chat-post-ref-chip"
            >
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
              <span className="min-w-0">
                <span className="line-clamp-2 text-xs font-medium text-[var(--kp-text-1)]">{att.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--kp-text-3)]">
                  {att.garden}/{att.slug}
                </span>
              </span>
            </Link>
          );
        }
        if (!isChatImageAttachment(att)) return null;
        return (
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
        );
      })}
    </div>
  );
}

export interface ChatMessageListProps {
  messageGroups: MessageGroup[];
  messages: ChatMessage[];
  optimistic: OptimisticUserBubble[];
  liveTimeline: TimelineStep[];
  streamingContent: string;
  isStreaming: boolean;
  /** SSE 已接通；RESTORE 幽灵 streaming（connected=false）不得盖住已落库回复 */
  streamConnected: boolean;
  streamTargetUserId: string | null;
  inFlightAssistantId: string | null;
  isSubagentSession: boolean;
  copiedId: string | null;
  /** 正在编辑的消息 id（user 或 assistant） */
  editingMessageId: string | null;
  editDraft: string;
  editSaving?: boolean;
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
  /** 确认保存 Markdown 源码（仅落库，不重跑） */
  onEditConfirm: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  /** Chat → 知识库：打开落库对话框 */
  onSaveAsPost?: (messageId: string, content: string) => void;
  setEditingMessageId: (id: string | null) => void;
  setEditDraft: (draft: string) => void;
}

export const ChatMessageList = memo(function ChatMessageList({
  messageGroups,
  messages,
  optimistic,
  liveTimeline,
  streamingContent,
  isStreaming,
  streamConnected,
  streamTargetUserId,
  inFlightAssistantId,
  isSubagentSession,
  copiedId,
  editingMessageId,
  editDraft,
  editSaving = false,
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
  onSaveAsPost: handleSaveAsPost,
  setEditingMessageId,
  setEditDraft,
}: ChatMessageListProps) {
  // 语音输出：assistant 回复朗读（浏览器原生 speechSynthesis，免费）
  const { supported: ttsSupported, speaking: ttsSpeaking, speak: ttsSpeak, cancel: ttsCancel } =
    useSpeechSynthesis({ lang: "zh-CN", rate: 1 });
  const [speakingAssistantId, setSpeakingAssistantId] = useState<string | null>(null);
  useEffect(() => {
    // 外部 TTS 引擎停讲 → 清 UI 高亮（非可派生的同步，必须 effect）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 订阅 ttsSpeaking 外部态
    if (!ttsSpeaking) setSpeakingAssistantId(null);
  }, [ttsSpeaking]);
  const handleSpeak = useCallback(
    (assistantId: string, content: string) => {
      if (speakingAssistantId === assistantId) {
        ttsCancel();
        setSpeakingAssistantId(null);
      } else {
        setSpeakingAssistantId(assistantId);
        ttsSpeak(content);
      }
    },
    [speakingAssistantId, ttsCancel, ttsSpeak],
  );

  // #12 Swarm 新手引导（可关闭，localStorage 记忆）
  // 初始恒为 false，mount 后再读 localStorage，避免 SSR/首屏 hydration 不一致
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    // mount 后读 localStorage 同步到 React state（SSR 安全），非派生数据。
    try {
      if (localStorage.getItem("kp-swarm-onboarding-dismissed") !== "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydrate
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

  // 虚拟列表句柄：导航 / 切会话落底 / 贴底跟随
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  /** 运行栏定位投递气泡时短暂高亮 */
  const [highlightJobId, setHighlightJobId] = useState<string | null>(null);
  /** 右侧导航：当前视口对应的回复横杠下标 */
  const [navActiveIdx, setNavActiveIdx] = useState<number | null>(null);
  /** 离开底部时显示「回到底部」按钮 */
  const [isAtBottom, setIsAtBottom] = useState(true);
  /**
   * 钉底意图：Viz/流式高度估算抖动时 atBottom 会短暂 false，
   * 若只信瞬时 atBottom，followOutput 被掐 → 视口甩到顶部。
   * 仅用户真正上滑（非回底过渡窗）才解除。
   */
  const stickToBottomRef = useRef(true);
  /** 点击回底后的短窗口：忽略中间的 false atBottom */
  const scrollToBottomPendingUntilRef = useRef(0);
  /** 点击导航后短暂钉住高亮，避免 Virtuoso 估算滚动未到位时 rangeChanged 抢回上一轮 */
  const navPinUntilRef = useRef(0);
  useEffect(() => {
    // 切会话重置导航/贴底 UI 意图（外部会话 id 变化，非可纯派生）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session switch reset
    setNavActiveIdx(null);
    navPinUntilRef.current = 0;
    stickToBottomRef.current = true;
    scrollToBottomPendingUntilRef.current = 0;
    setIsAtBottom(true);
  }, [effectiveSessionId]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
    if (atBottom) {
      stickToBottomRef.current = true;
      return;
    }
    if (Date.now() < scrollToBottomPendingUntilRef.current) return;
    stickToBottomRef.current = false;
  }, []);

  const showLiveStream = isStreaming || liveTimeline.length > 0 || !!streamingContent;
  /** 有真实 live 载荷，或 SSE 已接通——禁止 RESTORE 空壳盖住 stored assistant */
  const hasLivePayload = liveTimeline.length > 0 || !!streamingContent.trim();
  const lastGroupIndex = messageGroups.length - 1;

  const lastStepsByGroupRef = useRef<Map<string, TimelineStep[]>>(new Map());

  const renderIntermediateSteps = (group: MessageGroup) => {
    const active = getActiveVersion(group);
    if (!active) return null;
    const groupKey = group.userMessage.id;
    const steps = buildTimelineFromStored(active.toolCalls);
    // 防御：toolCalls 被部分更新导致 steps 为空时，保留上一次非空 steps，避免 thinking 闪烁消失
    if (steps.length > 0) {
      lastStepsByGroupRef.current.set(groupKey, steps);
    }
    const displaySteps = steps.length > 0 ? steps : (lastStepsByGroupRef.current.get(groupKey) ?? []);
    if (!displaySteps.length) return null;
    return (
      <div className="flex w-full justify-start">
        <ThinkingTimeline steps={displaySteps} isLive={false} />
      </div>
    );
  };

  const renderAssistantBubble = (group: MessageGroup, isLastGroup: boolean) => {
    const active = getActiveVersion(group);
    if (!active || !group.assistantMessage) return null;
    const assistantId = group.assistantMessage.id;
    const isInterrupted = group.assistantMessage.finishReason === "aborted";
    const isEditingAssistant = editingMessageId === assistantId;
    const editBusy = isStreaming || editSaving;

    return (
      <div
        key={`a-${assistantId}`}
        data-testid="assistant-message-bubble"
        className="group/msg relative mb-6 ml-6 mr-2 flex w-full max-w-[96%] flex-col items-start gap-1"
      >
        <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3.5 py-2 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
          {isEditingAssistant ? (
            <MessageMarkdownSourceEditor
              value={editDraft}
              onChange={setEditDraft}
              onSave={() => handleEditConfirm(assistantId)}
              onCancel={() => setEditingMessageId(null)}
              disabled={editBusy}
            />
          ) : (
            <PostContent
              content={active.content.trimEnd()}
              className="prose-sm kp-chat-md max-w-none text-left"
            />
          )}
          {isInterrupted && !isEditingAssistant && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
              <Ban className="h-3 w-3" />
              <span>已停止生成</span>
            </div>
          )}
        </div>

        <MessageActions
          onCopy={() =>
            handleCopy(assistantId, isEditingAssistant ? editDraft : active.content).catch(catchUnlessCancelled("components/chatMessageList.tsx"))
          }
          onShare={() =>
            handleShare(isEditingAssistant ? editDraft : active.content).catch(catchUnlessCancelled("components/chatMessageList.tsx"))
          }
          onRegenerate={() => handleRegenerate(group.userMessage.id)}
          onSpeak={
            ttsSupported && !isEditingAssistant
              ? () => handleSpeak(assistantId, active.content)
              : undefined
          }
          isSpeaking={speakingAssistantId === assistantId && ttsSpeaking}
          showRegenerate={isLastGroup && !isEditingAssistant}
          showEdit
          showRetry={false}
          showSpeak={!isEditingAssistant}
          showSaveAsPost={
            !!handleSaveAsPost && !!active.content.trim() && !isEditingAssistant
          }
          onSaveAsPost={
            handleSaveAsPost
              ? () => handleSaveAsPost(assistantId, active.content)
              : undefined
          }
          onEdit={() => {
            setEditingMessageId(assistantId);
            setEditDraft(active.content);
          }}
          onEditSave={() => handleEditConfirm(assistantId)}
          onEditCancel={() => setEditingMessageId(null)}
          isEditing={isEditingAssistant}
          disabled={editBusy}
          copied={copiedId === assistantId}
          versionNav={
            !isEditingAssistant && group.versions.length > 1 ? (
              <MessageVersions
                current={group.activeVersionIndex}
                total={group.versions.length}
                onPrev={() => handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex - 1).catch(catchUnlessCancelled("components/chatMessageList.tsx"))}
                onNext={() => handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex + 1).catch(catchUnlessCancelled("components/chatMessageList.tsx"))}
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
          {/* Thinking 计时只在「末步仍是 thinking 且尚无正文流式」时继续；
              一旦开始吐正文 / 工具准备，Thinking 停表，避免组装参数阶段假计时 */}
          <ThinkingTimeline
            steps={liveTimeline}
            isLive={!streamingContent.trim()}
          />
        </div>
      )}
      {showLiveStream && (
        <div className="flex w-full justify-start">
          <div
            className={cn(
              "group/msg ml-6 mr-2 flex w-full max-w-[96%] flex-col items-start gap-1",
              streamingContent ? "mb-6" : "mb-4",
            )}
            data-testid="streaming-assistant-bubble"
          >
            {streamingContent ? (
              <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3.5 py-2 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
                {/* 流式期轻量渲染：避免每 token 跑完整 remark/rehype/高亮。
                    落库终态气泡仍用 PostContent（代码预览 / viz / 画板）。 */}
                <StreamingPlainContent
                  content={streamingContent.trimEnd()}
                  className="prose-sm kp-chat-md max-w-none text-left"
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
    const isEditing = editingMessageId === group.userMessage.id;
    const editBusy = isStreaming || editSaving;
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
    // 心跳 / cron：放右侧（通知位），与用户手发消息区分（角标不同）
    const isHeartbeat = msgSource === "system";
    const isCron = msgSource === "cron";
    const cronMeta = (msgToolResults as { cron?: { name?: string } } | undefined)?.cron;
    const isSystemish = isHeartbeat || isCron;
    const isRightSide = isSystemish || isChildNotify
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
              // scroll-mt-20：点击导航 scrollIntoView(block:start) 时顶部留 80px，避免气泡顶到视口角落
              "group/msg relative mb-3 flex w-full max-w-[96%] flex-col gap-1 scroll-mt-20",
              isRightSide ? "items-stretch self-end" : "items-stretch self-start",
              deliveryJobId &&
                highlightJobId === deliveryJobId &&
                "rounded-2xl ring-2 ring-[var(--kp-brand)] ring-offset-2 ring-offset-[var(--kp-bg)]",
            )}
          >
            {group.userMessage.attachments &&
              group.userMessage.attachments.length > 0 &&
              !isEditing && (
                <UserAttachmentChips attachments={group.userMessage.attachments} />
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
                cronName={isCron ? cronMeta?.name : undefined}
              />
              {group.userMessage.skillName && (
                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.5 text-[10px] text-[var(--kp-brand-deep)]">
                  <LucideIconByName name={group.userMessage.skillIcon} className="h-3 w-3" />
                  {group.userMessage.skillName}
                </span>
              )}
              {isEditing ? (
                <MessageMarkdownSourceEditor
                  value={editDraft}
                  onChange={setEditDraft}
                  onSave={() => handleEditConfirm(group.userMessage.id)}
                  onCancel={() => setEditingMessageId(null)}
                  disabled={editBusy}
                />
              ) : (
                // 用户消息一律 Markdown 渲染（含普通提问 / 异步投递 / 父下发任务）
                <PostContent
                  content={group.userMessage.content}
                  className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
                />
              )}
            </div>
            <MessageActions
              onCopy={() => handleCopy(group.userMessage.id, isEditing ? editDraft : group.userMessage.content).catch(catchUnlessCancelled("components/chatMessageList.tsx"))}
              onShare={() => handleShare(isEditing ? editDraft : group.userMessage.content).catch(catchUnlessCancelled("components/chatMessageList.tsx"))}
              onEdit={() => {
                setEditingMessageId(group.userMessage.id);
                setEditDraft(group.userMessage.content);
              }}
              onEditSave={() => handleEditConfirm(group.userMessage.id)}
              onEditCancel={() => setEditingMessageId(null)}
              onRetry={() => handleRetry(group.userMessage.id)}
              showEdit={!isSystemish}
              showRetry={isLastUser && !isEditing && !isSystemish}
              showRegenerate={false}
              isEditing={isEditing}
              disabled={editBusy}
              copied={copiedId === group.userMessage.id}
            />
          </div>
        </div>
        {(isStreaming &&
          streamTargetUserId === group.userMessage.id &&
          (streamConnected || hasLivePayload)) ||
        (!!group.assistantMessage && group.assistantMessage.id === inFlightAssistantId)
          ? // INV-4：本轮流式的组由 live 块独占；幽灵 restore（未 connected 且无载荷）不抢 stored
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
  const renderOptimisticMessage = (msg: {
    id: string;
    content: string;
    attachments?: ChatAttachment[];
  }) => (
    <div className="mb-4 flex justify-end">
      <div className="flex w-full max-w-[96%] flex-col items-stretch gap-1.5">
        {msg.attachments && msg.attachments.length > 0 && (
          <UserAttachmentChips attachments={msg.attachments} dimmed />
        )}
        <div className="w-full min-w-[min(100%,6rem)] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-4 py-3 text-sm text-[var(--kp-text-1)] opacity-80">
          <PostContent
            content={msg.content}
            className="prose-sm max-w-none text-left text-[var(--kp-text-1)] opacity-100 [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
          />
        </div>
      </div>
    </div>
  );

  // 统一虚拟列表数据：消息组 + 乐观消息 + 尾部流式块（仅 !streamTargetUserId 时）
  type ChatItem =
    | { kind: "group"; key: string; group: MessageGroup; index: number }
    | { kind: "optimistic"; key: string; msg: { id: string; content: string; attachments?: ChatAttachment[]; createdAt?: number } }
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

  // 冷加载：仅 view hydrate 完成后撤 hold（禁止「有任意一条消息」当就绪 → 闪成最近窗）。
  // holdRef 只在 layout effect 里写（流式不额外 setState）；进冷加载时冻入 state，
  // 渲染期只读 staleHold/chatItems——满足 react-hooks/refs。
  const holdRef = useRef<ChatItem[]>([]);
  const [staleHold, setStaleHold] = useState<ChatItem[] | null>(null);
  const wasColdRef = useRef(false);
  const sessionReady =
    !effectiveSessionId ||
    isMessagesHydrated ||
    ((isStreaming || optimistic.length > 0) && chatItems.length > 0);
  const isColdLoading = !!effectiveSessionId && !sessionReady;
  useLayoutEffect(() => {
    if (sessionReady) holdRef.current = chatItems;
  }, [sessionReady, chatItems]);
  useLayoutEffect(() => {
    if (isColdLoading) {
      if (!wasColdRef.current) {
        wasColdRef.current = true;
        const snap = holdRef.current;
        setStaleHold(snap.length > 0 ? snap : null);
      }
      return;
    }
    if (wasColdRef.current) {
      wasColdRef.current = false;
      setStaleHold(null);
    }
  }, [isColdLoading]);
  const showingStale = staleHold !== null;
  const displayItems = staleHold ?? chatItems;
  const hasDisplay = displayItems.length > 0;

  const scrollToBottom = useCallback(() => {
    const last = Math.max(0, displayItems.length - 1);
    stickToBottomRef.current = true;
    scrollToBottomPendingUntilRef.current = Date.now() + 800;
    setIsAtBottom(true);
    virtuosoRef.current?.scrollToIndex({
      index: last,
      align: "end",
      behavior: "auto",
    });
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: Math.max(0, displayItems.length - 1),
        align: "end",
        behavior: "auto",
      });
      virtuosoRef.current?.autoscrollToBottom();
    });
  }, [displayItems.length]);

  // 末条增高（流式 / Viz 撑高不改 totalCount）时，钉底意图下补 autoscrollToBottom
  const lastRowGrowthKey = useMemo(() => {
    const last = displayItems[displayItems.length - 1];
    if (!last) return "empty";
    if (last.kind === "live") {
      return `live:${streamingContent.length}:${liveTimeline.length}`;
    }
    if (last.kind === "group") {
      const a = last.group.assistantMessage;
      const toolsLen = a?.toolCalls ? JSON.stringify(a.toolCalls).length : 0;
      return `g:${last.key}:${a?.content?.length ?? 0}:${toolsLen}`;
    }
    if (last.kind === "optimistic") {
      return `o:${last.key}:${last.msg.content.length}`;
    }
    return last.key;
  }, [displayItems, streamingContent, liveTimeline.length]);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    virtuosoRef.current?.autoscrollToBottom();
  }, [lastRowGrowthKey]);

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
    stickToBottomRef.current = true;
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
                <li>· 右上角选择「见微超级 Agent」，让它替你管理其他 Agent</li>
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
            // 列表短于视口时贴底（官方 chat 配方）
            alignToBottom
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
            // 钉底意图优先：Viz/高度抖动时 atBottom 短暂 false 仍继续跟随
            followOutput={(atBottom) =>
              stickToBottomRef.current || atBottom ? "auto" : false
            }
            atBottomStateChange={handleAtBottomStateChange}
            atBottomThreshold={120}
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
                loadOlderMessages().catch(catchUnlessCancelled("components/chatMessageList.tsx"));
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
      {/* 回到底部：一次性 scrollToIndex + autoscrollToBottom */}
      {hasDisplay && !isAtBottom && (
        <button
          type="button"
          data-testid="scroll-to-bottom"
          aria-label="回到底部"
          onClick={scrollToBottom}
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
