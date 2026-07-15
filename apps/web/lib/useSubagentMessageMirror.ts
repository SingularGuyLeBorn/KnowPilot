"use client";

/**
 * useSubagentMessageMirror —— 子 Agent 会话：把 pending AgentMessage 幂等镜像进 SessionQueueItem。
 *
 * 【子 Agent 镜像域】effect 体自 chat.tsx 原样迁入（含 exhaustive-deps 豁免）。
 * 若 triggerAgentRun 已写入同内容 ChatMessage，则直接 markConsumed，
 * 避免队列再消费导致「消息发两遍」。
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { type ChatMessage } from "@knowpilot/shared";

type PendingAgentMessage = {
  id: string;
  content: string;
  source: string | null;
};

export function useSubagentMessageMirror(opts: {
  effectiveSessionId: string | null;
  isSubagentSession: boolean;
  pendingAgentMessages: PendingAgentMessage[] | undefined;
  messages: ChatMessage[];
  refetchSessionQueue: () => unknown;
}) {
  const {
    effectiveSessionId,
    isSubagentSession,
    pendingAgentMessages,
    messages,
    refetchSessionQueue,
  } = opts;
  const createSessionQueueItemMutation = trpc.agent.createSessionQueueItem.useMutation();
  const markAgentMessageConsumedMutation = trpc.agent.markAgentMessageConsumed.useMutation();

  // 子 Agent 会话：把 pending AgentMessage 镜像进 SessionQueueItem（幂等）
  useEffect(() => {
    if (!effectiveSessionId || !isSubagentSession || !pendingAgentMessages?.length) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      // 并行镜像：N 条 pending 消息同时发，不串行阻塞渲染（旧实现顺序 await 导致进入子会话卡死）
      const results = await Promise.allSettled(
        pendingAgentMessages.map(async (msg) => {
          const alreadyInChat = messages.some(
            (m) => m.role === "user" && m.content.trim() === String(msg.content ?? "").trim(),
          );
          if (alreadyInChat) {
            try {
              await markAgentMessageConsumedMutation.mutateAsync({ messageId: msg.id });
            } catch {
              /* ignore */
            }
            return;
          }
          try {
            await createSessionQueueItemMutation.mutateAsync({
              sessionId: effectiveSessionId,
              kind: "superior",
              content: msg.content,
              // AgentMessage.source 是 tier（super/manager），不是 fromAgentId
              source: msg.source || "manager",
              agentMessageId: msg.id,
            });
          } catch {
            // 幂等冲突或网络错误忽略
          }
        }),
      );
      if (cancelled) return;
      // 仅当至少有一条实际处理（非全 rejected）才 refetch
      if (results.some((r) => r.status === "fulfilled")) {
        void refetchSessionQueue();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSessionId, isSubagentSession, pendingAgentMessages, messages]);
}
