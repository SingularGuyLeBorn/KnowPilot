"use client";

/**
 * ChatSessionPane —— 单个会话中栏：订阅该 session 的三层 store + 队列 query，渲染 ChatCenterPane。
 * 编排（runStream / drain）仍由父级注入，经 targetSessionId 指向本 pane。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MutableRefObject,
} from "react";
import { trpc } from "@/lib/trpc";
import { stopAgentChat, copyToClipboard } from "@/lib/agentStream";
import { getModelOption } from "@/lib/chatConfig";
import { buildMessageGroups } from "@/lib/chatMessageUtils";
import { type Agent, type ChatMessage, type ChatSessionConfig, type Skill } from "@knowpilot/shared";
import { ChatCenterPane } from "@/components/chatCenterPane";
import { type ChatMessageListProps } from "@/components/chatMessageList";
import { type SelectedSkill } from "@/components/chatInput";
import {
  type ChatQueueItem,
  createUserQueueItem,
  sessionQueueItemToChatItem,
  mergeUserQueueFromDb,
} from "@/lib/chatQueueTypes";
import { useSessionMessages } from "@/lib/useSessionMessages";
import { useStreamLifecycle, streamLifecycleActions, streamLifecycleStore } from "@/lib/useStreamLifecycle";
import { useSessionComposeState, sessionComposeActions } from "@/lib/useSessionComposeState";
import { useChatConfig } from "@/lib/useChatConfig";
import { useChatAsyncOverlayEffects } from "@/lib/useChatAsyncOverlayEffects";
import { useSubagentMessageMirror } from "@/lib/useSubagentMessageMirror";
import { useChatEnqueue } from "@/lib/useChatEnqueue";
import { useChatDerivedQueues } from "@/lib/useChatDerivedQueues";
import { useResumeSession } from "@/lib/hooks";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";
import { sessionLabel } from "@/lib/displayLabels";
import { cn } from "@/lib/utils";
import type { RunStreamOptions } from "@/lib/useChatRunStream";

export interface ChatSessionPaneProps {
  sessionId: string | null;
  isFocused: boolean;
  onFocus: () => void;
  /** 父级：打开/聚焦某会话（子任务条跳转父会话等） */
  selectSession: (id: string) => void;
  backendDown: boolean;
  leftOpen: boolean;
  setLeftOpen: ComponentProps<typeof ChatCenterPane>["setLeftOpen"];
  skills: Skill[];
  selectedAgent: Agent | undefined;
  hasWorkspaces: boolean;
  runStream: (opts: RunStreamOptions) => Promise<void>;
  consumeRef: MutableRefObject<(preferredSessionId?: string) => void>;
  createSessionQueueItemMutation: ReturnType<typeof trpc.agent.createSessionQueueItem.useMutation>;
  submitInjectMutation: ReturnType<typeof trpc.agent.submitInject.useMutation>;
  deleteSessionQueueItemMutation: ReturnType<typeof trpc.agent.deleteSessionQueueItem.useMutation>;
  reorderSessionQueueItemsMutation: ReturnType<typeof trpc.agent.reorderSessionQueueItems.useMutation>;
  asyncQueueStats: ComponentProps<typeof ChatCenterPane>["asyncStats"];
  rotateBanner: { newSessionId: string; newTitle: string } | null;
  setRotateBanner: (banner: { newSessionId: string; newTitle: string } | null) => void;
  showToast: (msg: string | null) => void;
  onOpenPromptEditor: () => void;
  /** 向父级上报本 pane 的 chatConfig（焦点 pane 供 runStream / Prompt overlay 使用） */
  onChatConfigChange?: (sessionId: string | null, config: ChatSessionConfig) => void;
  onChatConfigApiChange?: (
    sessionId: string | null,
    api: {
      updateConfig: (patch: Partial<ChatSessionConfig>) => void;
      resetPromptToAgent: () => void;
    },
  ) => void;
}

export function ChatSessionPane({
  sessionId,
  isFocused,
  onFocus,
  selectSession,
  backendDown,
  leftOpen,
  setLeftOpen,
  skills,
  selectedAgent,
  hasWorkspaces,
  runStream,
  consumeRef,
  createSessionQueueItemMutation,
  submitInjectMutation,
  deleteSessionQueueItemMutation,
  reorderSessionQueueItemsMutation,
  asyncQueueStats,
  rotateBanner,
  setRotateBanner,
  showToast,
  onOpenPromptEditor,
  onChatConfigChange,
  onChatConfigApiChange,
}: ChatSessionPaneProps) {
  const lifecycleKey = sessionId ?? NEW_STREAM_KEY;

  const {
    messages,
    isMessagesHydrated,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    hydrateFromServer,
  } = useSessionMessages(sessionId);
  const { state: lifecycleState, isStreaming } = useStreamLifecycle(lifecycleKey);
  const { state: composeState } = useSessionComposeState(lifecycleKey);

  const streamingContent = lifecycleState.streamingContent;
  const liveTimeline = lifecycleState.liveTimeline;
  const streamTargetUserId = lifecycleState.streamTargetUserId;
  const inFlightAssistantId =
    lifecycleState.phase === "streaming" || lifecycleState.phase === "done"
      ? lifecycleState.inFlightAssistantId
      : null;
  const streamError = lifecycleState.error;
  const optimistic = composeState.optimistic;
  const userQueue = composeState.userQueue;
  const asyncOverlays = composeState.asyncOverlays;
  const consumedDeliveries = composeState.consumedDeliveries;

  const [viewError, setViewError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SelectedSkill | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const error = viewError ?? streamError;

  const { data: sessionDetail } = trpc.session.getById.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId },
  );
  const isSubagentSession =
    sessionDetail?.kind === "subagent" || !!sessionDetail?.parentSessionId;
  const parentSessionId = sessionDetail?.parentSessionId ?? null;
  const { data: parentSession } = trpc.session.getById.useQuery(
    { id: parentSessionId! },
    { enabled: !!parentSessionId },
  );

  const asyncQueueQuery = trpc.agent.pullAsyncQueue.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId && !backendDown,
      refetchInterval: (query) => (query.state.error ? 15_000 : false),
      refetchOnWindowFocus: true,
    },
  );
  const sessionQueueQuery = trpc.agent.listSessionQueueItems.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId && !backendDown,
      refetchInterval: 3_000,
      refetchOnWindowFocus: true,
    },
  );

  const agentIdForPull = sessionDetail?.agentId ?? selectedAgent?.id;
  const pullAgentMessagesQuery = trpc.agent.pullAgentMessages.useQuery(
    { agentId: agentIdForPull! },
    {
      enabled: !!agentIdForPull && !!isSubagentSession && !backendDown,
      refetchInterval: (query) =>
        isSubagentSession && query.state.error ? 10_000 : false,
      refetchOnWindowFocus: true,
    },
  );

  useChatAsyncOverlayEffects({
    effectiveSessionId: sessionId,
    asyncOverlays,
    consumedDeliveries,
    asyncQueueQuery,
  });

  const queueHydrateSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) {
      queueHydrateSessionRef.current = null;
      return;
    }
    if (!sessionQueueQuery.data) return;
    const sessionChanged = queueHydrateSessionRef.current !== sessionId;
    queueHydrateSessionRef.current = sessionId;
    if (sessionChanged) {
      sessionComposeActions.setUserQueue(
        sessionId,
        sessionQueueQuery.data.map(sessionQueueItemToChatItem),
      );
    } else {
      sessionComposeActions.patchUserQueue(sessionId, (prev) =>
        mergeUserQueueFromDb(prev, sessionQueueQuery.data!),
      );
    }
    streamLifecycleActions.hydrateDone(sessionId);
  }, [sessionId, sessionQueueQuery.data]);

  useSubagentMessageMirror({
    effectiveSessionId: sessionId,
    isSubagentSession,
    pendingAgentMessages: pullAgentMessagesQuery.data,
    messages,
    refetchSessionQueue: sessionQueueQuery.refetch,
  });

  const { chatConfig, updateConfig, resetPromptToAgent } = useChatConfig({
    effectiveSessionId: sessionId,
    selectedAgent,
    sessionDetailModel: sessionDetail?.model,
    sessionDetailSystemPrompt: sessionDetail?.systemPrompt,
  });

  useEffect(() => {
    if (isFocused) onChatConfigChange?.(sessionId, chatConfig);
  }, [isFocused, sessionId, chatConfig, onChatConfigChange]);

  useEffect(() => {
    if (isFocused) onChatConfigApiChange?.(sessionId, { updateConfig, resetPromptToAgent });
  }, [isFocused, sessionId, updateConfig, resetPromptToAgent, onChatConfigApiChange]);

  const { asyncResultQueue, queue } = useChatDerivedQueues({
    asyncOverlays,
    asyncQueueQuery,
    consumedDeliveries,
    userQueue,
  });
  void asyncResultQueue;

  const modelOpt = getModelOption(chatConfig.model);
  const messageGroups = useMemo(() => buildMessageGroups(messages), [messages]);
  const lastUserMessageId = useMemo(() => {
    if (messageGroups.length === 0) return null;
    return messageGroups[messageGroups.length - 1].userMessage.id;
  }, [messageGroups]);

  const isSessionRunOccupied = useCallback(
    (sid: string | null) => streamLifecycleStore.isRunOccupied(sid),
    [],
  );
  const isSessionStreaming = useCallback(
    (sid: string | null) => streamLifecycleStore.isStreaming(sid),
    [],
  );

  const { enqueueMessage } = useChatEnqueue({
    backendDown,
    effectiveSessionId: sessionId,
    sessionStatus: sessionDetail?.status,
    createSessionQueueItemMutation,
    submitInjectMutation,
    isSessionRunOccupied,
    showToast,
    consumeRef,
  });

  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistQueueOrder = useCallback(
    (items: ChatQueueItem[]) => {
      if (!sessionId) return;
      const orderedIds = items.map((i) => i.dbId).filter((id): id is string => !!id);
      if (orderedIds.length === 0) return;
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      reorderTimerRef.current = setTimeout(() => {
        reorderSessionQueueItemsMutation.mutate({ sessionId, orderedIds });
      }, 500);
    },
    [sessionId, reorderSessionQueueItemsMutation],
  );

  const handleStop = useCallback(async () => {
    if (sessionId) {
      try {
        await stopAgentChat(sessionId);
      } catch {
        /* continue abort */
      }
    }
    sessionComposeActions.getActiveAbortController(sessionId)?.abort();
  }, [sessionId]);

  const { mutate: resumeSession, isPending: resumePending } = useResumeSession({
    onError: (msg) => showToast(`恢复会话失败：${msg}`),
  });
  const handleResumeSession = useCallback(() => {
    if (!sessionId) return;
    resumeSession({ id: sessionId });
  }, [sessionId, resumeSession]);

  const switchVersion = trpc.message.switchVersion.useMutation();
  const switchVersionMutateAsync = switchVersion.mutateAsync;

  const handleRegenerate = useCallback(
    (userMessageId: string) => {
      if (!sessionId || isSessionRunOccupied(sessionId)) return;
      void runStream({
        regenerate: true,
        regenerateUserMessageId: userMessageId,
        targetSessionId: sessionId,
        keepCurrentView: !isFocused,
      });
    },
    [sessionId, isSessionRunOccupied, runStream, isFocused],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!sessionId || isSessionRunOccupied(sessionId)) return;
      void runStream({
        retryFromMessageId: messageId,
        targetSessionId: sessionId,
        keepCurrentView: !isFocused,
      });
    },
    [sessionId, isSessionRunOccupied, runStream, isFocused],
  );

  const handleTimeoutRetryInBackground = useCallback(
    (lastText: string) => {
      const sid = sessionId ?? NEW_STREAM_KEY;
      sessionComposeActions.patchUserQueue(sid, (prev) => [
        ...prev,
        createUserQueueItem(
          `请用 async_task_run 在后台执行这个任务（避免前台超时）：\n${lastText}`,
        ),
      ]);
      streamLifecycleActions.clearError(sid);
      setViewError(null);
      consumeRef.current(sid);
    },
    [sessionId, consumeRef],
  );

  const handleEditConfirm = useCallback(
    (userMessageId: string) => {
      const content = editDraft.trim();
      if (!content || isSessionRunOccupied(sessionId)) return;
      void runStream({
        editMessageId: userMessageId,
        editContent: content,
        targetSessionId: sessionId ?? undefined,
        keepCurrentView: !isFocused,
      });
    },
    [editDraft, sessionId, isSessionRunOccupied, runStream, isFocused],
  );

  const handleSwitchVersion = useCallback(
    async (assistantMessageId: string, versionIndex: number) => {
      if (isSessionStreaming(sessionId)) return;
      await switchVersionMutateAsync({ messageId: assistantMessageId, versionIndex });
      void hydrateFromServer();
    },
    [sessionId, isSessionStreaming, switchVersionMutateAsync, hydrateFromServer],
  );

  const handleCopy = useCallback(async (id: string, content: string) => {
    if (await copyToClipboard(content)) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, []);

  const handleShare = useCallback(async (content: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: content });
        return;
      }
    } catch {
      /* fallback */
    }
    if (await copyToClipboard(content)) {
      setCopiedId("share");
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, []);

  const messageListProps: ChatMessageListProps = useMemo(
    () => ({
      messageGroups,
      messages: messages as ChatMessage[],
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
      effectiveSessionId: sessionId,
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
    }),
    [
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
      sessionId,
      backendDown,
      hasWorkspaces,
      hasOlderMessages,
      isLoadingOlderMessages,
      loadOlderMessages,
      handleCopy,
      handleShare,
      handleRegenerate,
      handleSwitchVersion,
      handleEditConfirm,
      handleRetry,
    ],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        isFocused ? "ring-1 ring-inset ring-[var(--kp-brand)]/30" : "",
      )}
      data-testid="chat-session-pane"
      data-session-id={sessionId ?? "new"}
      data-focused={isFocused ? "true" : "false"}
      onMouseDown={onFocus}
    >
      <ChatCenterPane
        effectiveSessionId={sessionId}
        sessionDetail={sessionDetail}
        isLoadingOlderMessages={isLoadingOlderMessages}
        isStreaming={isStreaming}
        selectedAgentName={selectedAgent?.name}
        chatConfigModel={chatConfig.model}
        chatConfigSystemPrompt={chatConfig.systemPrompt}
        queueLength={queue.length}
        compactPending={isSessionRunOccupied(sessionId ?? "")}
        onCompact={() => enqueueMessage("请压缩当前会话上下文")}
        leftOpen={leftOpen}
        setLeftOpen={setLeftOpen}
        isSubagentSession={!!isSubagentSession}
        parentSessionId={parentSessionId}
        parentSessionTitle={parentSession ? sessionLabel(parentSession) : undefined}
        backendDown={backendDown}
        rotateBanner={isFocused ? rotateBanner : null}
        setRotateBanner={setRotateBanner}
        selectSession={selectSession}
        messageListProps={messageListProps}
        error={error}
        lastUserMessageId={lastUserMessageId}
        onRetry={handleRetry}
        onTimeoutRetryInBackground={handleTimeoutRetryInBackground}
        userQueue={userQueue}
        asyncQueueData={asyncQueueQuery.data}
        asyncStats={asyncQueueStats}
        persistQueueOrder={persistQueueOrder}
        deleteSessionQueueItemMutation={deleteSessionQueueItemMutation}
        onSend={enqueueMessage}
        onStop={handleStop}
        onResumeSession={handleResumeSession}
        resumePending={resumePending}
        skills={skills}
        selectedSkill={selectedSkill}
        onSkillChange={setSelectedSkill}
        modelHint={
          modelOpt.inputHint ??
          (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")
        }
        supportsVision={!!modelOpt.supportsVision}
        chatConfig={chatConfig}
        updateConfig={updateConfig}
        resetPromptToAgent={resetPromptToAgent}
        onOpenPromptEditor={onOpenPromptEditor}
        modelSupportsReasoning={!!modelOpt.supportsThinking}
        modelReasoningRequired={!!modelOpt.reasoningRequired}
      />
    </div>
  );
}
