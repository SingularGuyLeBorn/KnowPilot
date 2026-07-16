"use client";

/**
 * ChatCenterPane —— 中栏（W13e 从 chat.tsx 拆出）。
 * 包含中栏 header（面板开关 / 标题 / 模型摘要 / SessionContextBar / Agent 管理链接）、
 * 子 Agent 任务条、移动端 SessionContextBar、后端离线 banner、session_rotate 跳转 banner、
 * 消息列表（ChatMessageList props 原样透传）、错误条（预算/超时/重试动作）、
 * composer 接线（UserSendQueuePanel + ChatInputArea）。
 * 纯结构拆分：enqueueMessage/consumeQueue/runStream 编排与 INV-1~8 状态机仍留在 chat.tsx，
 * 数据与回调全部经 props 受控注入（沿用 ChatSidebarProps 模式）。
 *
 * W16b memo 判定：不包 React.memo——本组件就是「消息列表相关组件」（messageListProps
 * 流式期每 token 真变），按「token 更新只触发消息列表相关组件重渲染」标准它应当随
 * token 重渲染；memo 永远不会命中，加了只是误导。屏障设在 ChatSidebar /
 * ChatRightPanel / ChatOverlays / ChatMessageList。
 */

import Link from "next/link";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Loader2,
  PanelLeft,
  PanelRight,
  Play,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { type ChatSession, type Skill } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { SessionContextBar } from "@/components/sessionContextUsage";
import { ChatInputArea, type SelectedSkill } from "@/components/chatInput";
import {
  type ChatQueueItem,
  sortQueueItems,
  splitQueueByKind,
} from "@/lib/chatQueueTypes";
import { UserSendQueuePanel } from "@/components/chatQueue";
import { ChatMessageList, type ChatMessageListProps } from "@/components/chatMessageList";
import { sessionComposeActions } from "@/lib/useSessionComposeState";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";

type SessionDetail = ChatSession | undefined;

export interface ChatCenterPaneProps {
  // 中栏 header 受控态与派生显示值
  effectiveSessionId: string | null;
  sessionDetail: SessionDetail;
  isLoadingOlderMessages: boolean;
  isStreaming: boolean;
  selectedAgentName: string | undefined;
  chatConfigModel: string;
  chatConfigSystemPrompt: string;
  queueLength: number;
  compactPending: boolean;
  onCompact: () => void;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  // 子 Agent 任务条
  isSubagentSession: boolean;
  parentSessionId: string | null;
  parentSessionTitle: string | undefined;
  // 横幅群：后端离线 / session_rotate 跳转
  backendDown: boolean;
  rotateBanner: { newSessionId: string; newTitle: string } | null;
  setRotateBanner: (banner: { newSessionId: string; newTitle: string } | null) => void;
  selectSession: (id: string) => void;
  // 消息列表：W13a 组件 props 原样透传
  messageListProps: ChatMessageListProps;
  // 错误条：错误文本与三个动作（预算设置 / 转后台重试 / 重试）
  error: string | null;
  lastUserMessageId: string | null;
  onRetry: (messageId: string) => void;
  onTimeoutRetryInBackground: (lastText: string) => void;
  // composer 接线：发送队列面板 + 输入区
  userQueue: ChatQueueItem[];
  asyncQueueData: Parameters<typeof splitQueueByKind>[1];
  asyncStats: ComponentProps<typeof UserSendQueuePanel>["asyncStats"];
  persistQueueOrder: (items: ChatQueueItem[]) => void;
  deleteSessionQueueItemMutation: ReturnType<typeof trpc.agent.deleteSessionQueueItem.useMutation>;
  onSend: ComponentProps<typeof ChatInputArea>["onSend"];
  onStop: () => void;
  // C-3：paused 会话「恢复运行」入口（子 Agent 任务条状态标签处 + 普通会话横幅）
  onResumeSession: () => void;
  resumePending: boolean;
  skills: Skill[];
  selectedSkill: SelectedSkill | null;
  onSkillChange: (skill: SelectedSkill | null) => void;
  modelHint: string;
  supportsVision: boolean;
  onOpenConfig: () => void;
}

export function ChatCenterPane({
  effectiveSessionId,
  sessionDetail,
  isLoadingOlderMessages,
  isStreaming,
  selectedAgentName,
  chatConfigModel,
  chatConfigSystemPrompt,
  queueLength,
  compactPending,
  onCompact,
  setLeftOpen,
  setRightOpen,
  isSubagentSession,
  parentSessionId,
  parentSessionTitle,
  backendDown,
  rotateBanner,
  setRotateBanner,
  selectSession,
  messageListProps,
  error,
  lastUserMessageId,
  onRetry: handleRetry,
  onTimeoutRetryInBackground,
  userQueue,
  asyncQueueData,
  asyncStats,
  persistQueueOrder,
  deleteSessionQueueItemMutation,
  onSend,
  onStop,
  onResumeSession,
  resumePending,
  skills,
  selectedSkill,
  onSkillChange,
  modelHint,
  supportsVision,
  onOpenConfig,
}: ChatCenterPaneProps) {
  const { messages, messageGroups } = messageListProps;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-4 py-2.5">
        <button type="button" onClick={() => setLeftOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
          <PanelLeft className="h-4 w-4" />
        </button>
        <Bot className="h-5 w-5 shrink-0 text-[var(--kp-brand)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">
              {sessionDetail?.autoName || sessionDetail?.title || "Agent 对话"}
            </h1>
            {isLoadingOlderMessages && !isStreaming && (
              <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-text-3)]" />
            )}
          </div>
          <p className="truncate text-xs text-[var(--kp-text-3)]">
            {selectedAgentName ?? "—"} · {chatConfigModel}
            {queueLength > 0 && ` · 队列 ${queueLength}`}
          </p>
        </div>
        {effectiveSessionId && sessionDetail && (
          <SessionContextBar
            messages={messages}
            systemPrompt={chatConfigSystemPrompt}
            modelId={chatConfigModel}
            contextSummary={sessionDetail.contextSummary}
            onCompact={onCompact}
            compactPending={compactPending}
            className="hidden shrink-0 lg:flex"
          />
        )}
        <Link href="/agents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:flex text-xs")}>Agent 管理</Link>
        <button type="button" onClick={() => setRightOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
          <PanelRight className="h-4 w-4" />
        </button>
      </header>

      {isSubagentSession && (
        <div
          data-testid="subagent-context-bar"
          className="flex items-center gap-2 border-b border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-4 py-1.5 text-xs"
        >
          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
          <span className="font-medium text-[var(--kp-brand-deep)]">子 Agent 任务</span>
          {sessionDetail?.status && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                sessionDetail.status === "running" || sessionDetail.status === "queued"
                  ? "bg-blue-100 text-blue-700"
                  : sessionDetail.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : sessionDetail.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700",
              )}
            >
              {sessionDetail.status === "running" && "运行中"}
              {sessionDetail.status === "queued" && "排队中"}
              {sessionDetail.status === "completed" && "已完成"}
              {sessionDetail.status === "failed" && "失败"}
              {sessionDetail.status === "paused" && "已暂停"}
              {sessionDetail.status === "active" && "活跃"}
              {!["running", "queued", "completed", "failed", "paused", "active"].includes(sessionDetail.status) && sessionDetail.status}
            </span>
          )}
          {/* C-3：paused 子会话「恢复运行」入口（状态标签处） */}
          {sessionDetail?.status === "paused" && (
            <button
              type="button"
              data-testid="resume-session-button"
              disabled={resumePending}
              onClick={onResumeSession}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--kp-brand-deep)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {resumePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              恢复运行
            </button>
          )}
          {sessionDetail?.taskDescription && (
            <span className="min-w-0 flex-1 truncate text-[var(--kp-text-2)]">
              {sessionDetail.taskDescription}
            </span>
          )}
          {parentSessionId && (
            <Link
              href={`/chat?sessionId=${parentSessionId}`}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
              title="返回父会话"
            >
              <ArrowLeft className="h-3 w-3" />
              来自会话{parentSessionTitle ? ` · ${parentSessionTitle.slice(0, 16)}` : ""}
            </Link>
          )}
        </div>
      )}

      {effectiveSessionId && sessionDetail && (
        <div className="flex border-b border-[var(--kp-divider)] px-4 py-2 lg:hidden">
          <SessionContextBar
            messages={messages}
            systemPrompt={chatConfigSystemPrompt}
            modelId={chatConfigModel}
            contextSummary={sessionDetail.contextSummary}
            onCompact={onCompact}
            compactPending={compactPending}
          />
        </div>
      )}

      {backendDown && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>后端未连接，请运行 <code className="rounded bg-amber-100 px-1">pnpm dev</code></span>
        </div>
      )}

      {(rotateBanner || (sessionDetail?.status === "archived" && sessionDetail.rotatedToSessionId)) && (
        <div
          data-testid="session-rotate-banner"
          className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-3 py-2 text-xs text-[var(--kp-brand-deep)]"
        >
          <span className="min-w-0 flex-1 truncate">
            新 session 已创建：
            {rotateBanner?.newTitle ?? "续写会话"}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md bg-[var(--kp-brand-deep)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
            onClick={() => {
              const id = rotateBanner?.newSessionId ?? sessionDetail?.rotatedToSessionId;
              if (!id) return;
              setRotateBanner(null);
              selectSession(id);
            }}
          >
            点击跳转
          </button>
          {rotateBanner && (
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              aria-label="关闭提示"
              onClick={() => setRotateBanner(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* C-3：paused 普通会话「恢复运行」横幅（子会话入口在上方任务条状态标签处） */}
      {!isSubagentSession && sessionDetail?.status === "paused" && (
        <div
          data-testid="session-resume-banner"
          className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-3 py-2 text-xs text-[var(--kp-brand-deep)]"
        >
          <span className="min-w-0 flex-1 truncate">会话已暂停（服务重启前未完成的轮次可继续）</span>
          <button
            type="button"
            data-testid="resume-session-button"
            disabled={resumePending}
            onClick={onResumeSession}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--kp-brand-deep)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {resumePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            恢复运行
          </button>
        </div>
      )}

      <ChatMessageList {...messageListProps} />

      {error && (
        <div
          className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800"
          data-testid="chat-error-banner"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">请求失败</p>
              <p className="whitespace-pre-wrap leading-relaxed opacity-90">{error}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* 错误可操作化：按错误类型提供针对性动作（#14） */}
              {error.includes("预算") && (
                <Link
                  href="/settings"
                  className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                >
                  查看预算设置
                </Link>
              )}
              {(error.includes("超时") || error.includes("timeout")) && (
                <button
                  type="button"
                  onClick={() => {
                    // 超时 → 建议转后台任务：把上一条用户消息包装成 async_task_run 请求重新入队
                    const lastGroup = messageGroups[messageGroups.length - 1];
                    const lastText = lastGroup?.userMessage.content;
                    if (lastText) {
                      onTimeoutRetryInBackground(lastText);
                    }
                  }}
                  className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                >
                  转后台重试
                </button>
              )}
              {lastUserMessageId && (
                <button
                  type="button"
                  onClick={() => handleRetry(lastUserMessageId)}
                  className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--kp-divider)] px-4 pt-3 md:px-6">
        <UserSendQueuePanel
          items={sortQueueItems(userQueue)}
          onChange={(items) => {
            const { userQueue: uq, asyncOverlays: ao } = splitQueueByKind(items, asyncQueueData);
            sessionComposeActions.setUserQueue(effectiveSessionId ?? NEW_STREAM_KEY, uq);
            sessionComposeActions.setAsyncOverlays(effectiveSessionId ?? NEW_STREAM_KEY, ao);
            persistQueueOrder(uq);
          }}
          onRemove={(id) => {
            const target = userQueue.find((t) => t.id === id);
            sessionComposeActions.removeUserQueueItem(effectiveSessionId ?? NEW_STREAM_KEY, id);
            sessionComposeActions.patchAsyncOverlays(effectiveSessionId ?? NEW_STREAM_KEY, (q) =>
              q.filter((t) => t.id !== id),
            );
            if (target?.dbId) {
              deleteSessionQueueItemMutation.mutate({ id: target.dbId });
            }
          }}
          asyncStats={asyncStats}
        />
        <ChatInputArea
          key={effectiveSessionId ?? "new"}
          onSend={onSend}
          onStop={onStop}
          disabled={backendDown || sessionDetail?.status === "archived"}
          isStreaming={isStreaming}
          queueLength={userQueue.length}
          skills={skills}
          selectedSkill={selectedSkill}
          onSkillChange={onSkillChange}
          modelHint={modelHint}
          modelId={chatConfigModel}
          supportsVision={supportsVision}
          onOpenConfig={onOpenConfig}
          sessionHint={
            sessionDetail?.status === "archived"
              ? sessionDetail.rotatedToSessionId
                ? "此会话已归档。请点击上方提示跳转到新会话继续对话。"
                : "此会话已归档，无法继续发送消息。"
              : isSubagentSession
                ? "这是子 Agent 任务会话。你直接发送的消息只在本会话内处理，不会回传父会话；只有父 Agent 下发的任务结果才会投递回父会话。"
                : undefined
          }
          sessionId={effectiveSessionId}
        />
      </div>
    </div>
  );
}
