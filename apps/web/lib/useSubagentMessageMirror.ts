"use client";

/**
 * useSubagentMessageMirror —— 子 Agent 会话：把 pending AgentMessage 幂等镜像进 SessionQueueItem。
 *
 * 【子 Agent 镜像域】effect 体自 chat.tsx 原样迁入（含 exhaustive-deps 豁免）。
 * 权威键 = agentMessageId（服务端 create 幂等 + shouldSkipSuperiorMirror）。
 * 禁止用 content 正文撞名判重——同文 user/历史 superior 会误 markConsumed，吞掉上级新指令（E7）。
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

type PendingAgentMessage = {
  id: string;
  content: string;
  source: string | null;
};

export function useSubagentMessageMirror(opts: {
  effectiveSessionId: string | null;
  isSubagentSession: boolean;
  pendingAgentMessages: PendingAgentMessage[] | undefined;
  /** 保留入参以兼容调用方；判重不再读 messages */
  messages: unknown;
  refetchSessionQueue: () => Promise<unknown>;
}) {
  const {
    effectiveSessionId,
    isSubagentSession,
    pendingAgentMessages,
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
          try {
            const created = await createSessionQueueItemMutation.mutateAsync({
              sessionId: effectiveSessionId,
              kind: "superior",
              content: msg.content,
              // AgentMessage.source 是 tier（super/manager），不是 fromAgentId
              source: msg.source || "manager",
              agentMessageId: msg.id,
            });
            // 服务端 shouldSkipSuperiorMirror：success 但无 data → 已投递/对账跳过，回写 consumed
            if (created?.success && !created.data) {
              await markAgentMessageConsumedMutation.mutateAsync({ messageId: msg.id }).catch(() => {});
            }
          } catch {
            // 幂等冲突或网络错误忽略
          }
        }),
      );
      if (cancelled) return;
      // 仅当至少有一条实际处理（非全 rejected）才 refetch
      if (results.some((r) => r.status === "fulfilled")) {
        refetchSessionQueue().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSessionId, isSubagentSession, pendingAgentMessages]);
}
