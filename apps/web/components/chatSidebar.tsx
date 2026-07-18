"use client";

/**
 * ChatSidebar —— 左栏（W13b 从 chat.tsx 拆出）。
 * 顶层 Tab：对话 | 运行。运行 Tab 合并投递队列（RuntimeStatusPanel）与 Task 追溯（AsyncTaskPanel）。
 *
 * W16b：React.memo 渲染屏障——左栏 props 不含任何流式派生值，流式期 ChatView
 * 每 token 重渲染时左栏整树跳过。前提是 ChatView 侧 props 全部引用稳定
 * （mutation 只注入稳定的 .mutate 函数，不注入每渲染新建的 mutation 对象）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ListChecks, PanelLeftClose, Plus, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAgent } from "@/lib/hooks";
import { cn, groupBySessionDate } from "@/lib/utils";
import { type Agent } from "@knowpilot/shared";
import { type ChatQueueItem, type SyncTaskItem } from "@/lib/chatQueueTypes";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared";
import { AsyncTaskPanel } from "@/components/asyncTaskPanel";
import { RuntimeStatusPanel } from "@/components/chatQueue";
import { WorkspaceTree } from "@/components/workspaceTree";
import { WorkspaceSelect } from "@/components/workspaceSelect";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import { SessionListItem } from "@/components/chatSessionListItem";
import { useAsyncProgressSteps } from "@/lib/useAsyncProgressSteps";
import { sessionMessagesStore } from "@/lib/useSessionMessages";
import { streamLifecycleActions } from "@/lib/useStreamLifecycle";
import { sessionComposeActions } from "@/lib/useSessionComposeState";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";
import type { ChatLeftTab } from "@/lib/useChatUiPrefs";

export interface ChatSidebarProps {
  leftOpen: boolean;
  setLeftOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  leftTab: ChatLeftTab;
  setLeftTab: (tab: ChatLeftTab) => void;
  historySubTab: "main" | "sub";
  setHistorySubTab: (tab: "main" | "sub") => void;
  syncChatUiToUrl: (patch: { view?: "main" | "sub"; panel?: "history" | "runtime" }) => void;
  effectiveSessionId: string | null;
  effectiveAgentId: string;
  mainSessionId: string | null;
  mainAgentId: string;
  isSubagentSession: boolean;
  parentSessionId: string | null;
  selectedWorkspaceId: string | null;
  selectedAgent: Agent | undefined;
  asyncResultQueue: ChatQueueItem[];
  selectSession: (id: string) => void;
  openInOtherPane?: (id: string) => void;
  openTabIds?: string[];
  closeTab?: (id: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  startNewChat: () => void;
  editingSessionId: string | null;
  setEditingSessionId: (id: string | null) => void;
  renameDraft: string;
  setRenameDraft: (draft: string) => void;
  handleSessionHover: (id: string) => void;
  handleSessionHoverEnd: (id: string) => void;
  setShowCreateSubagent: (open: boolean) => void;
  setError: (msg: string | null) => void;
  setToast: (msg: string | null) => void;
  refetchSession: () => void;
  cancelAsyncJobMutate: ReturnType<typeof trpc.agent.cancelAsyncJob.useMutation>["mutate"];
  retryAsyncJobMutate: ReturnType<typeof trpc.agent.retryAsyncJob.useMutation>["mutate"];
  pinAsyncJobMutate: ReturnType<typeof trpc.agent.toggleAsyncJobPinned.useMutation>["mutate"];
  runtimeGroupTab: "async" | "sync";
  setRuntimeGroupTab: (tab: "async" | "sync") => void;
  syncTaskItems: SyncTaskItem[];
  runtimeActiveItems: ChatQueueItem[];
  runtimeToConsumeItems: ChatQueueItem[];
  runtimeConsumedItems: ChatQueueItem[];
}

export const ChatSidebar = memo(function ChatSidebar({
  leftOpen,
  setLeftOpen,
  leftTab,
  setLeftTab,
  historySubTab,
  setHistorySubTab,
  syncChatUiToUrl,
  effectiveSessionId,
  effectiveAgentId,
  mainSessionId,
  mainAgentId,
  isSubagentSession,
  parentSessionId,
  selectedWorkspaceId,
  selectedAgent,
  asyncResultQueue,
  selectSession,
  openInOtherPane,
  openTabIds = [],
  closeTab,
  selectWorkspace,
  startNewChat,
  editingSessionId,
  setEditingSessionId,
  renameDraft,
  setRenameDraft,
  handleSessionHover,
  handleSessionHoverEnd,
  setShowCreateSubagent,
  setError,
  setToast,
  refetchSession,
  cancelAsyncJobMutate,
  retryAsyncJobMutate,
  pinAsyncJobMutate,
  runtimeGroupTab,
  setRuntimeGroupTab,
  syncTaskItems,
  runtimeActiveItems,
  runtimeToConsumeItems,
  runtimeConsumedItems,
}: ChatSidebarProps) {
  // 与 ChatView 相同 key 的查询订阅：React Query 按 key 共享缓存并去重请求，无额外网络开销
  const { useList: useAgentList } = useAgent();
  const agentsQuery = useAgentList({ page: 1, pageSize: 100 });
  const sessionsQuery = trpc.session.list.useQuery({ page: 1, pageSize: 40 });
  // Swarm：拉取 Workspace 列表判断是否显示 Workspace 树
  const workspacesQuery = trpc.workspace.list.useQuery({ page: 1, pageSize: 100, status: "active" });
  const hasWorkspaces = (workspacesQuery.data?.items ?? []).length > 0;
  const utils = trpc.useUtils();
  const updateSession = trpc.session.update.useMutation();
  const deleteSession = trpc.session.delete.useMutation();
  const bulkDeleteMutation = trpc.session.bulkDelete.useMutation();

  // 异步任务活跃数（子 Agent 会话下以父会话为锚点）
  const asyncTaskCountQuery = trpc.task.list.useQuery(
    { page: 1, pageSize: 50, sessionId: mainSessionId ?? undefined },
    { enabled: !!mainSessionId },
  );
  const asyncTaskActiveCount = useMemo(() => {
    const items = (asyncTaskCountQuery.data?.items ?? []) as { status?: string }[];
    return items.filter((t) => t.status === "running" || t.status === "queued").length;
  }, [asyncTaskCountQuery.data?.items]);

  // 左栏专属 state
  const [sessionSearch, setSessionSearch] = useState("");
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{ id: string; title: string } | null>(null);
  // #11 会话批量管理
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // 父会话实时任务进度时间线：从合并后的 asyncResultQueue 纯派生，构建逻辑见
  // useAsyncProgressSteps（W13c 外提至 apps/web/lib/useAsyncProgressSteps.ts）
  const asyncProgressSteps = useAsyncProgressSteps(asyncResultQueue);

  const filteredSessions = useMemo(() => {
    const items = sessionsQuery.data?.items ?? [];
    // 主 Agent 标签页只显示当前主 Agent 的会话；子 Agent 任务会话由「子 Agent」标签页隔离，
    // 避免不同 Agent 的会话混在一起。子 Agent 会话下以父 Agent 为锚点，确保能切回父会话。
    const anchorAgentId = mainAgentId;
    const agentFiltered = anchorAgentId
      ? items.filter(
          (s) =>
            s.kind !== "subagent" &&
            (s.agentId === anchorAgentId || !s.agentId),
        )
      : items.filter((s) => s.kind !== "subagent");
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return agentFiltered;
    return agentFiltered.filter(
      (s) =>
        (s.autoName || s.title || "").toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q),
    );
  }, [sessionsQuery.data?.items, sessionSearch, mainAgentId]);

  const groupedSessions = useMemo(
    () => groupBySessionDate(filteredSessions),
    [filteredSessions],
  );

  // 当前 Workspace 下的子 Agent 数量（用于子 Agent 标签徽标）
  const currentSubAgentCount = useMemo(() => {
    return (agentsQuery.data?.items ?? []).filter(
      (a: Agent) => a.workspaceId === selectedWorkspaceId && a.tier === "sub" && a.status !== "deleted",
    ).length;
  }, [agentsQuery.data?.items, selectedWorkspaceId]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      // 写 autoName（显示优先字段），而非 title。否则自动命名过的 session
      // autoName 已有值，改 title 被 autoName 屏蔽 → 重命名「屁都没有」。
      // 写 autoName 后 autoNameSession 的幂等检查（autoName 已有值跳过）也保证不会被自动命名覆盖。
      const res = await updateSession.mutateAsync({ id, autoName: trimmed });
      if (!res.success) {
        setError(res.error?.message ?? "重命名失败");
        return;
      }
      void utils.session.list.invalidate();
      if (effectiveSessionId === id) void refetchSession();
      setEditingSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }, [updateSession, utils.session.list, effectiveSessionId, refetchSession, setError, setEditingSessionId]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await deleteSession.mutateAsync({ id });
      if (!res.success) {
        setError(res.error?.message ?? "删除失败");
        setDeleteSessionTarget(null);
        return;
      }
      // 清理 MessageStore 缓存 + 关闭 EventSource + 忘记 hydrate 标记，否则删除后残留数据 / 连接泄漏
      sessionMessagesStore.clearSession(id);
      sessionMessagesStore.forgetSession(id);
      // 三层 store 统一清理：StreamLifecycle + Compose 也会残留已删 session 的 state
      streamLifecycleActions.deleteSession(id);
      sessionComposeActions.deleteComposeSession(id);
      closeTab?.(id);
      void utils.session.list.invalidate();
      if (effectiveSessionId === id) startNewChat();
      setDeleteSessionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleteSessionTarget(null);
    }
  }, [deleteSession, effectiveSessionId, startNewChat, closeTab, utils.session.list, setError]);

  // 会话列表项交互回调：保持引用稳定，避免每次输入都触发所有 SessionListItem 重渲染
  const handleSessionSelect = useCallback((id: string) => {
    if (bulkMode) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      selectSession(id);
    }
  }, [bulkMode, selectSession]);

  const handleStartRename = useCallback((id: string) => {
    setEditingSessionId(id);
    const s = sessionsQuery.data?.items.find((x) => x.id === id);
    // 预填当前显示名（autoName 优先于 title），否则编辑框显示旧 title 误导用户
    setRenameDraft(s?.autoName || s?.title || "");
  }, [sessionsQuery.data?.items, setEditingSessionId, setRenameDraft]);

  const renameDraftRef = useRef(renameDraft);
  useEffect(() => {
    renameDraftRef.current = renameDraft;
  }, [renameDraft]);
  const handleConfirmRename = useCallback((id: string) => {
    void handleRenameSession(id, renameDraftRef.current);
  }, [handleRenameSession]);

  const handleCancelRename = useCallback(() => {
    setEditingSessionId(null);
  }, [setEditingSessionId]);

  const handleRequestDelete = useCallback((id: string) => {
    const s = sessionsQuery.data?.items.find((x) => x.id === id);
    if (s) {
      setDeleteSessionTarget({ id: s.id, title: s.autoName || s.title || "新对话" });
      return;
    }
    // WorkspaceTree 子 Agent 会话可能不在主 sessionsQuery 里
    setDeleteSessionTarget({ id, title: "该会话" });
  }, [sessionsQuery.data?.items]);

  const runtimeBadgeCount = Math.max(runtimeActiveItems.length, asyncTaskActiveCount);

  // 左栏内容：避免 JSX 内嵌多层三元表达式导致解析/维护困难
  const leftPanelBody = (() => {
    if (leftTab === "runtime") {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="left-runtime-panel">
          <section className="border-b border-[var(--kp-divider)]" data-testid="left-runtime-delivery">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
              投递队列
            </div>
            <div className="min-h-[200px]">
              <RuntimeStatusPanel
                groupTab={runtimeGroupTab}
                onGroupTabChange={setRuntimeGroupTab}
                activeItems={runtimeActiveItems}
                toConsumeItems={runtimeToConsumeItems}
                consumedItems={runtimeConsumedItems}
                syncTaskItems={syncTaskItems}
                onCancel={(jobId) => cancelAsyncJobMutate({ jobId })}
                onTogglePin={(jobId, pinned) => pinAsyncJobMutate({ jobId, pinned })}
              />
            </div>
          </section>
          <section data-testid="left-runtime-tasks">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
              Task 追溯
            </div>
            {asyncProgressSteps.length > 0 && (
              <div className="border-b border-[var(--kp-divider)] px-3 pb-2" data-testid="async-progress-block">
                <ThinkingTimeline steps={asyncProgressSteps} isLive />
              </div>
            )}
            <AsyncTaskPanel
              parentSessionId={mainSessionId ?? undefined}
              onCancelJob={(jobId) => cancelAsyncJobMutate({ jobId })}
              onRetryJob={(jobId) => {
                sessionComposeActions.markDeliveryConsumed(effectiveSessionId ?? NEW_STREAM_KEY, jobId);
                retryAsyncJobMutate({ jobId });
              }}
            />
          </section>
        </div>
      );
    }
    const isMain = historySubTab === "main";
    return (
      <>
        {/* 对话历史子标签：与顶层「对话|运行」同款圆角分段 */}
        <div className="px-3 py-2">
          <div className="flex gap-1 rounded-xl bg-[var(--kp-bg-mute)] p-0.5">
            <button
              type="button"
              onClick={() => {
                setHistorySubTab("main");
                syncChatUiToUrl({ view: "main" });
                if (isSubagentSession && parentSessionId) {
                  selectSession(parentSessionId);
                }
              }}
              data-testid="history-subtab-main"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
                isMain
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              主 Agent
            </button>
            <button
              type="button"
              onClick={() => {
                setHistorySubTab("sub");
                syncChatUiToUrl({ view: "sub" });
              }}
              data-testid="history-subtab-sub"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
                !isMain
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              子 Agent
              {currentSubAgentCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-bg)]/80 px-1.5 py-0 text-[9px] font-semibold text-[var(--kp-text-2)]">
                  {currentSubAgentCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="w-64 border-b border-[var(--kp-divider)] px-3 py-2">
          <WorkspaceSelect
            value={selectedWorkspaceId}
            workspaces={workspacesQuery.data?.items ?? []}
            onChange={selectWorkspace}
            disabled={workspacesQuery.isLoading}
          />
        </div>

        <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">
            {isMain ? "对话历史" : "子 Agent"}
          </h2>
          <div className="flex items-center gap-0.5">
            {isMain ? (
              <>
                {/* #11 批量管理模式切换 */}
                <button
                  type="button"
                  onClick={() => {
                    setBulkMode((v) => !v);
                    setBulkSelected(new Set());
                  }}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "h-8 w-8",
                    bulkMode && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
                  )}
                  aria-label="批量管理"
                  title="批量管理会话"
                >
                  <ListChecks className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={startNewChat}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
                  aria-label="新建对话"
                  title="新建对话（发送首条消息时创建）"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="subagent-create-button"
                onClick={() => setShowCreateSubagent(true)}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
                aria-label="新建子 Agent 任务"
                title="新建子 Agent 任务"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* 批量操作条（仅主 Agent 标签） */}
        {isMain && bulkMode && (
          <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/30 px-3 py-2 text-xs">
            <span className="text-[var(--kp-text-2)]">已选 {bulkSelected.size}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setBulkSelected(new Set(filteredSessions.map((s) => s.id)))}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
              >
                全选
              </button>
              <button
                type="button"
                disabled={bulkSelected.size === 0 || bulkDeleteMutation.isPending}
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                {bulkDeleteMutation.isPending ? "删除中…" : "删除所选"}
              </button>
            </div>
          </div>
        )}

        <div className="w-64 border-b border-[var(--kp-divider)] px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--kp-text-3)]" />
            <input
              type="search"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder={isMain ? "搜索会话…" : "搜索子 Agent…"}
              data-testid="session-search"
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--kp-brand)]"
            />
          </div>
        </div>

        <div className="w-64 flex-1 overflow-y-auto p-2" data-testid="session-list">
          {hasWorkspaces ? (
            /* Swarm 模式：当前 Workspace → Agent → Session 树 */
            <WorkspaceTree
              currentWorkspaceId={selectedWorkspaceId}
              effectiveSessionId={effectiveSessionId}
              effectiveAgentId={effectiveAgentId}
              agents={agentsQuery.data?.items ?? []}
              onSelectSession={selectSession}
              onHoverSession={handleSessionHover}
              onHoverSessionEnd={handleSessionHoverEnd}
              onDeleteSession={handleRequestDelete}
              onNewChat={startNewChat}
              searchQuery={sessionSearch}
              mode={isMain ? "main" : "sub"}
            />
          ) : (
            /* 非 swarm 模式：回退到扁平 session 列表 */
            <>
              {filteredSessions.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-[var(--kp-text-3)]">
                  {sessionSearch.trim() ? "无匹配会话" : "暂无对话"}
                </p>
              )}
              {groupedSessions.map((group) => (
                <div key={group.key} className="mb-3">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                    {group.label}
                  </p>
                  {group.items.map((s) => (
                    <div key={s.id} className={cn(bulkMode && "flex items-center gap-1.5")}>
                      {bulkMode && (
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(s.id)}
                          onChange={(e) => {
                            setBulkSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            });
                          }}
                          className="ml-1 h-3.5 w-3.5 shrink-0 accent-[var(--kp-brand)]"
                          aria-label={`选择会话 ${s.autoName || s.title}`}
                        />
                      )}
                      <div className={cn(bulkMode && "min-w-0 flex-1")}>
                        <SessionListItem
                          session={s}
                          active={effectiveSessionId === s.id}
                          isOpenTab={openTabIds.includes(s.id)}
                          editing={editingSessionId === s.id}
                          renameDraft={renameDraft}
                          onSelect={handleSessionSelect}
                          onOpenInOtherPane={openInOtherPane}
                          onHover={handleSessionHover}
                          onHoverEnd={handleSessionHoverEnd}
                          onStartRename={handleStartRename}
                          onRenameDraftChange={setRenameDraft}
                          onConfirmRename={handleConfirmRename}
                          onCancelRename={handleCancelRename}
                          onDelete={handleRequestDelete}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </>
    );
  })();

  return (
    <>
      <aside className={cn("flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] transition-all duration-300", leftOpen ? "w-64" : "w-0 overflow-hidden border-r-0")}>
        <div className="w-64 shrink-0 border-b border-[var(--kp-divider)] px-3 py-2.5" data-testid="chat-left-panel-header">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[var(--kp-text-1)]">
                {selectedAgent?.name ?? "assistant"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLeftOpen(false)}
              data-testid="chat-left-panel-collapse"
              title="折叠左侧栏"
              aria-label="折叠左侧栏"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7 shrink-0 text-[var(--kp-text-3)]")}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 左栏顶层标签：对话 | 运行 */}
          <div className="mt-2 flex gap-1 rounded-xl bg-[var(--kp-bg-mute)] p-0.5">
            <button
              type="button"
              onClick={() => {
                setLeftTab("history");
                syncChatUiToUrl({ panel: "history" });
              }}
              data-testid="left-tab-history"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
                leftTab === "history"
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              对话
            </button>
            <button
              type="button"
              onClick={() => {
                setLeftTab("runtime");
                syncChatUiToUrl({ panel: "runtime" });
              }}
              data-testid="left-tab-runtime"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
                leftTab === "runtime"
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              运行
              {runtimeBadgeCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-brand-soft)] px-1 py-0 text-[9px] font-semibold text-[var(--kp-brand-deep)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]" />
                  {runtimeBadgeCount}
                </span>
              )}
            </button>
          </div>
        </div>
        {leftPanelBody}
      </aside>

      <ConfirmDialog
        isOpen={!!deleteSessionTarget}
        title="删除会话"
        description={`确定删除「${deleteSessionTarget?.title ?? ""}」？所有消息将被永久删除。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => deleteSessionTarget && void handleDeleteSession(deleteSessionTarget.id)}
        onCancel={() => setDeleteSessionTarget(null)}
      />

      {/* #11 批量删除确认 */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        title="批量删除会话"
        description={`确定删除所选的 ${bulkSelected.size} 个会话？所有消息将被永久删除。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          const ids = [...bulkSelected];
          setShowBulkDeleteConfirm(false);
          bulkDeleteMutation.mutate(
            { ids },
            {
              onSuccess: (res) => {
                setToast(`已删除 ${res.deleted} 个会话`);
                setTimeout(() => setToast(null), 2500);
                setBulkSelected(new Set());
                setBulkMode(false);
                if (effectiveSessionId && ids.includes(effectiveSessionId)) startNewChat();
                void utils.session.list.invalidate();
              },
            },
          );
        }}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />
    </>
  );
});
