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
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { stopAgentChat, copyToClipboard } from "@/lib/agentStream";
import { getModelOption } from "@/lib/chatConfig";
import { buildMessageGroups } from "@/lib/chatMessageUtils";
import { type Agent, type ChatMessage, type Skill } from "@knowpilot/shared";
import { ChatCenterPane } from "@/components/chatCenterPane";
import { type ChatMessageListProps } from "@/components/chatMessageList";
import { type SelectedSkill } from "@/components/chatInput";
import {
  SaveMessageAsPostDialog,
  type SaveMessageAsPostTarget,
} from "@/components/saveMessageAsPostDialog";
import {
  type ChatQueueItem,
  countVisibleQueueItems,
  mergeUserQueueFromDb,
} from "@/lib/chatQueueTypes";
import { sessionMessagesStore, useSessionMessages } from "@/lib/useSessionMessages";
import { useStreamLifecycle, streamLifecycleActions, streamLifecycleStore } from "@/lib/useStreamLifecycle";
import {
  useSessionComposeState,
  sessionComposeActions,
  sessionComposeStore,
} from "@/lib/useSessionComposeState";
import { useChatConfig } from "@/lib/useChatConfig";
import { useChatAsyncOverlayEffects } from "@/lib/useChatAsyncOverlayEffects";
import { useSubagentMessageMirror } from "@/lib/useSubagentMessageMirror";
import { useChatEnqueue } from "@/lib/useChatEnqueue";
import { useChatDerivedQueues } from "@/lib/useChatDerivedQueues";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";
import { sessionLabel } from "@/lib/displayLabels";
import type { RunStreamOptions, RunStreamOutcome } from "@/lib/useChatRunStream";

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
  runStream: (opts: RunStreamOptions) => Promise<RunStreamOutcome>;
  consumeRef: MutableRefObject<(preferredSessionId?: string) => void>;
  createSessionQueueItemMutation: ReturnType<typeof trpc.agent.createSessionQueueItem.useMutation>;
  deleteSessionQueueItemMutation: ReturnType<typeof trpc.agent.deleteSessionQueueItem.useMutation>;
  reorderSessionQueueItemsMutation: ReturnType<typeof trpc.agent.reorderSessionQueueItems.useMutation>;
  asyncQueueStats: ComponentProps<typeof ChatCenterPane>["asyncStats"];
  rotateBanner: { newSessionId: string; newTitle: string } | null;
  setRotateBanner: (banner: { newSessionId: string; newTitle: string } | null) => void;
  showToast: (msg: string | null) => void;
  onOpenPromptEditor: () => void;
  onOpenFilesPanel?: () => void;
  filesPanelOpen?: boolean;
  /** 打开左栏「运行」Tab */
  onOpenRuntimePanel?: () => void;
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
  deleteSessionQueueItemMutation,
  reorderSessionQueueItemsMutation,
  asyncQueueStats,
  rotateBanner,
  setRotateBanner,
  showToast,
  onOpenPromptEditor,
  onOpenFilesPanel,
  filesPanelOpen,
  onOpenRuntimePanel,
}: ChatSessionPaneProps) {
  const [saveAsPostTarget, setSaveAsPostTarget] = useState<SaveMessageAsPostTarget | null>(null);
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
  const streamConnected = lifecycleState.connected;
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  // 切会话时在 render 期重置本会话 UI 态（React 推荐的 props→state 对齐写法，替代 effect setState）
  const [paneSessionId, setPaneSessionId] = useState(sessionId);
  if (paneSessionId !== sessionId) {
    setPaneSessionId(sessionId);
    setSelectedSkill(null);
    setEditingMessageId(null);
    setEditDraft("");
    setEditSaving(false);
    setViewError(null);
    setCopiedId(null);
  }
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
  const hasRotateEdge = !!(
    sessionDetail?.rotatedFromSessionId || sessionDetail?.rotatedToSessionId
  );
  const { data: rotateLineageData } = trpc.session.rotateLineage.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId && hasRotateEdge },
  );
  const rotateLineage = useMemo(() => {
    if (!rotateLineageData || rotateLineageData.nodes.length < 2) return null;
    return {
      nodes: rotateLineageData.nodes.map((n) => ({
        id: n.id,
        label: (n.autoName || n.title || "会话").slice(0, 20),
      })),
      currentIndex: rotateLineageData.currentIndex,
    };
  }, [rotateLineageData]);

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
      // 推优先；错误时 15s 兜底（与 chat.tsx 同 key 共享缓存，避免双 3s）
      refetchInterval: (query) => (query.state.error ? 15_000 : false),
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

  // E6：切会话与同会话统一 mergeUserQueueFromDb，保留无 dbId 本地项
  useEffect(() => {
    if (!sessionId) return;
    if (!sessionQueueQuery.data) return;
    // E6 统一 merge（禁 sessionChanged 全量替换）+ tombstone 防迟到 DB 塞回已认领项
    const tombstones = sessionComposeStore.get(sessionId).consumedQueueDbIds;
    sessionComposeActions.patchUserQueue(sessionId, (prev) =>
      mergeUserQueueFromDb(prev, sessionQueueQuery.data!, tombstones),
    );
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


  const {
    queue,
    runtimeActiveItems,
    runtimeToConsumeItems,
    syncTaskItems,
  } = useChatDerivedQueues({
    asyncOverlays,
    asyncQueueQuery,
    consumedDeliveries,
    userQueue,
  });

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

  const canStartDeepResearch =
    !!sessionId &&
    !isSubagentSession &&
    isMessagesHydrated &&
    messages.every((m) => {
      if (m.role !== "user") return true;
      const src = (m as { source?: string | null }).source ?? "user";
      return src !== "user";
    });

  const { enqueueMessage } = useChatEnqueue({
    backendDown,
    effectiveSessionId: sessionId,
    sessionStatus: sessionDetail?.status,
    isSubagentSession: !!isSubagentSession,
    canStartDeepResearch,
    createSessionQueueItemMutation,
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

  // 卸载时清理重排防抖定时器，避免组件卸载后 500ms 触发 mutation
  useEffect(() => {
    return () => {
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
    };
  }, []);

  const handleStop = useCallback(async () => {
    // E3：先拿 stop 契约 partialAssistantMessageId，再 applyUserStop——
    // 有 AC → abort() 交 AbortError 路径；无 AC（幽灵 streaming）→ 直接 ABORT_STREAM。
    // 禁止只 ?.abort() 后放任 phase=streaming（Stop 空操作根因）。
    if (!sessionId) return;
    let partialAssistantMessageId: string | null = null;
    try {
      const res = await stopAgentChat(sessionId);
      partialAssistantMessageId = res.partialAssistantMessageId;
    } catch {
      /* continue abort；契约未知时按 null（立即释放） */
      partialAssistantMessageId = null;
    }
    streamLifecycleActions.applyUserStop(sessionId, {
      partialAssistantMessageId,
      abortController: sessionComposeActions.getActiveAbortController(sessionId),
    });
  }, [sessionId]);

  const switchVersion = trpc.message.switchVersion.useMutation();
  const switchVersionMutateAsync = switchVersion.mutateAsync;
  const updateMessageMut = trpc.message.update.useMutation();
  const updateMessageMutateAsync = updateMessageMut.mutateAsync;

  const handleRegenerate = useCallback(
    (userMessageId: string) => {
      if (!sessionId || isSessionRunOccupied(sessionId)) return;
      runStream({
        regenerate: true,
        regenerateUserMessageId: userMessageId,
        targetSessionId: sessionId,
        keepCurrentView: !isFocused,
      }).catch(catchUnlessCancelled("components/chatSessionPane.tsx"));
    },
    [sessionId, isSessionRunOccupied, runStream, isFocused],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!sessionId || isSessionRunOccupied(sessionId)) return;
      runStream({
        retryFromMessageId: messageId,
        targetSessionId: sessionId,
        keepCurrentView: !isFocused,
      }).catch(catchUnlessCancelled("components/chatSessionPane.tsx"));
    },
    [sessionId, isSessionRunOccupied, runStream, isFocused],
  );

  const handleTimeoutRetryInBackground = useCallback(
    (lastText: string) => {
      const sid = sessionId ?? NEW_STREAM_KEY;
      streamLifecycleActions.clearError(sid);
      setViewError(null);
      // 走完整 enqueue（写 DB + dbId + drain），禁止只本地塞队列无持久化
      enqueueMessage(
        `请用 async_task_run 在后台执行这个任务（避免前台超时）：\n${lastText}`,
      );
    },
    [sessionId, enqueueMessage],
  );

  /** AI Studio 式：编辑 Markdown 源码后仅落库，不截断、不重跑 */
  const handleEditConfirm = useCallback(
    (messageId: string) => {
      if (!sessionId || editSaving || isSessionStreaming(sessionId)) return;
      const content = editDraft.trim();
      if (!content) return;
      setEditSaving(true);
      updateMessageMutateAsync({ id: messageId, content })
        .then((result) => {
          if (result.success && result.data) {
            sessionMessagesStore.upsertMessage(sessionId, result.data as ChatMessage);
          } else {
            hydrateFromServer().catch(catchUnlessCancelled("components/chatSessionPane.tsx"));
          }
          setEditingMessageId(null);
          setEditDraft("");
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "保存消息失败";
          setViewError(msg);
        })
        .finally(() => {
          setEditSaving(false);
        });
    },
    [
      sessionId,
      editDraft,
      editSaving,
      isSessionStreaming,
      updateMessageMutateAsync,
      hydrateFromServer,
    ],
  );

  const handleSwitchVersion = useCallback(
    async (assistantMessageId: string, versionIndex: number) => {
      if (isSessionStreaming(sessionId)) return;
      await switchVersionMutateAsync({ messageId: assistantMessageId, versionIndex });
      hydrateFromServer().catch(catchUnlessCancelled("components/chatSessionPane.tsx"));
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

  const handleSaveAsPost = useCallback(
    (messageId: string, content: string) => {
      if (!sessionId) {
        showToast("请先选择会话再写入知识库");
        return;
      }
      const firstLine =
        content
          .split("\n")
          .map((l) => l.replace(/^#+\s*/, "").trim())
          .find((l) => l.length > 0)
          ?.slice(0, 80) || undefined;
      setSaveAsPostTarget({
        sessionId,
        messageId,
        previewTitle: firstLine,
        previewExcerpt: content.replace(/\s+/g, " ").trim().slice(0, 220),
      });
    },
    [sessionId, showToast],
  );

  const messageListProps: ChatMessageListProps = useMemo(
    () => ({
      messageGroups,
      messages: messages as ChatMessage[],
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
      editSaving,
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
      onSaveAsPost: handleSaveAsPost,
      setEditingMessageId,
      setEditDraft,
    }),
    [
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
      editSaving,
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
      handleSaveAsPost,
    ],
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
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
        queueLength={
          countVisibleQueueItems(userQueue) +
          queue.filter((i) => i.kind !== "user").length
        }
        compactPending={isSessionRunOccupied(sessionId ?? "")}
        onCompact={() => enqueueMessage("请压缩当前会话上下文")}
        leftOpen={leftOpen}
        setLeftOpen={setLeftOpen}
        isSubagentSession={!!isSubagentSession}
        parentSessionId={parentSessionId}
        parentSessionTitle={parentSession ? sessionLabel(parentSession) : undefined}
        rotateLineage={rotateLineage}
        allowDeepResearch={canStartDeepResearch}
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
        onOpenFilesPanel={onOpenFilesPanel}
        filesPanelOpen={filesPanelOpen}
        modelSupportsReasoning={!!modelOpt.supportsThinking}
        modelReasoningRequired={!!modelOpt.reasoningRequired}
        dispatchActiveItems={runtimeActiveItems}
        dispatchToConsumeItems={runtimeToConsumeItems}
        dispatchSyncTasks={syncTaskItems}
        onOpenRuntimePanel={onOpenRuntimePanel}
      />

      <SaveMessageAsPostDialog
        open={!!saveAsPostTarget}
        target={saveAsPostTarget}
        onClose={() => setSaveAsPostTarget(null)}
        onSuccess={() => showToast("已写入知识库")}
      />
    </div>
  );
}
