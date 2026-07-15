"use client";

/**
 * useChatQueueDrain —— 发送队列 drain 编排簇（W13e 从 chat.tsx 拆出）。
 *
 * consumeQueue：从 async 结果队列 / 用户队列挑下一条就绪项，ACK/去重/乐观气泡后 runStream；
 * drainAllPendingQueues：优先消费 preferredSessionId，再扫描其它有待消费项的 session
 * （后台不抢视图）。纯结构拆分：useCallback 体与 deps 逐字未改，仅
 * chatConfig.model / sessionsQuery.data?.items 解构重命名为 chatConfigModel / sessionsItems，
 * 并追加注入的稳定 refs（identity 恒定，行为等价）。本 hook 不新增任何 useEffect；
 * INV-2 占用判断与 INV-8 drain 触发链（唯一钩子在 chat.tsx【drain 订阅】）语义不变。
 */

import { useCallback, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import { getModelOption } from "@/lib/chatConfig";
import { type ChatQueueItem, formatQueueItemForLlm } from "@/lib/chatQueueTypes";
import { sessionMessagesStore } from "@/lib/useSessionMessages";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { type RunStreamOptions } from "@/lib/useChatRunStream";

const NEW_STREAM_KEY = "__new__"; // 与 chat.tsx 同值：新会话首条消息发起时尚无 sessionId 的临时键

export interface UseChatQueueDrainParams {
  effectiveSessionId: string | null;
  asyncResultQueue: ChatQueueItem[];
  chatConfigModel: string;
  isSessionRunOccupied: (sid: string | null) => boolean;
  sessionsItems: Array<{ id: string; agentId?: string | null }> | undefined;
  consumeSessionQueueItemMutation: ReturnType<typeof trpc.agent.consumeSessionQueueItem.useMutation>;
  ackAsyncDeliveryMutation: ReturnType<typeof trpc.agent.ackAsyncDelivery.useMutation>;
  asyncQueueQuery: ReturnType<typeof trpc.agent.pullAsyncQueue.useQuery>;
  runStream: (opts: RunStreamOptions) => Promise<void>;
  consumeRef: RefObject<(preferredSessionId?: string) => void>;
}

export function useChatQueueDrain({
  effectiveSessionId,
  asyncResultQueue,
  chatConfigModel,
  isSessionRunOccupied,
  sessionsItems,
  consumeSessionQueueItemMutation,
  ackAsyncDeliveryMutation,
  asyncQueueQuery,
  runStream,
  consumeRef,
}: UseChatQueueDrainParams) {
  const utils = trpc.useUtils();

  const consumeQueue = useCallback((targetSessionId?: string) => {
    const viewSid = effectiveSessionId ?? NEW_STREAM_KEY;
    const sid = targetSessionId ?? viewSid;
    const compose = sessionComposeStore.get(sid);
    // INV-2：streaming|done 均占用，禁止开新流
    if (isSessionRunOccupied(sid) || compose.queueDraining) return;

    const isReady = (t: ChatQueueItem) =>
      t.kind !== "async-running" &&
      (t.text.trim() || t.asyncResult || t.attachments?.length);

    // 当前视图：可用 poll 合并后的 asyncResultQueue；后台 session：仅看本地 overlays
    // （异步投递的后台续跑主要由服务端 autoConsumeAsyncDelivery 完成）
    const asyncCandidates =
      sid === viewSid ? asyncResultQueue : compose.asyncOverlays;

    let asyncReady: ChatQueueItem | undefined;
    for (const t of asyncCandidates) {
      // serverConsumed = 服务端 autoConsume 已消费，纯展示，前端不再参与 CLAIM
      if (t.kind === "async-result" && !t.serverConsumed && isReady(t) && !t.pinned) {
        asyncReady = t;
        break;
      }
    }
    let userReady: ChatQueueItem | undefined;
    if (!asyncReady) {
      for (const t of compose.userQueue) {
        if ((t.kind === "user" || t.kind === "superior") && isReady(t)) {
          userReady = t;
          break;
        }
      }
    }
    const task = asyncReady ?? userReady;
    if (!task) return;

    if (task.kind === "superior" && sid === NEW_STREAM_KEY) {
      return;
    }

    const keepCurrentView = sid !== viewSid;
    const sessionMeta = (sessionsItems ?? []).find((s) => s.id === sid);
    const streamAgentId = sessionMeta?.agentId || undefined;

    sessionComposeActions.setQueueDraining(sid, true);

    void (async () => {
      if (task.kind === "async-result" && task.jobId) {
        sessionComposeActions.markDeliveryConsumed(sid, task.jobId);
        try {
          const ack = await ackAsyncDeliveryMutation.mutateAsync({ jobId: task.jobId });
          if (!ack.claimed) {
            sessionComposeActions.setQueueDraining(sid, false);
            void utils.session.listRunning.invalidate();
            if (sid === viewSid) void asyncQueueQuery.refetch();
            // 已释放 drain 锁且在 async 续体内（调用栈已 unwind），直接重试下一项
            consumeRef.current(sid);
            return;
          }
        } catch {
          sessionComposeActions.setQueueDraining(sid, false);
          return;
        }
      }

      if (task.kind === "user" || task.kind === "superior") {
        if (task.kind === "superior") {
          const sessionMessages = sessionMessagesStore.getMessages(sid);
          const already = sessionMessages.some(
            (m) => m.role === "user" && m.content.trim() === task.text.trim(),
          );
          if (already) {
            sessionComposeActions.removeUserQueueItem(sid, task.id);
            if (task.dbId) {
              consumeSessionQueueItemMutation.mutate({ id: task.dbId });
            }
            sessionComposeActions.setQueueDraining(sid, false);
            // 已释放 drain 锁且在 async 续体内，直接重试下一项
            consumeRef.current(sid);
            return;
          }
        }
        sessionComposeActions.removeUserQueueItem(sid, task.id);
        if (task.dbId) {
          consumeSessionQueueItemMutation.mutate({ id: task.dbId });
        }
      } else {
        if (task.jobId) {
          const finishedJobId = task.jobId;
          const finishedStatus = task.status ?? "done";
          const finishedResult = task.asyncResult ?? "";
          sessionComposeActions.patchAsyncOverlays(sid, (prev) => {
            const existing = prev.find((o) => o.jobId === finishedJobId);
            if (!existing) {
              sessionComposeActions.setActiveQueueTaskId(sid, task.id);
              return prev;
            }
            const updated: ChatQueueItem = {
              ...existing,
              id: `run-${finishedJobId}`,
              kind: "async-result",
              status: finishedStatus,
              asyncResult: finishedResult,
              removeAt: Date.now() + 5000,
            };
            sessionComposeActions.setActiveQueueTaskId(sid, updated.id);
            return prev.map((o) => (o.jobId === finishedJobId ? updated : o));
          });
        } else {
          sessionComposeActions.setActiveQueueTaskId(sid, task.id);
        }
      }

      const supportsVision = !!getModelOption(chatConfigModel).supportsVision;
      const streamMessage =
        formatQueueItemForLlm(task, supportsVision) ||
        (task.attachments?.length ? "（见附件）" : "");
      const streamAttachments = task.attachments?.map(
        ({ id, name, mimeType, previewUrl, extractedText, source }) => ({
          id,
          name,
          mimeType,
          previewUrl: previewUrl ?? "",
          extractedText,
          source,
        }),
      );
      const optimisticId = `opt-${task.id}`;
      const isAsyncResult = task.kind === "async-result";
      const optimisticText = task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
      const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
      if (!isAsyncResult && (optimisticText || optimisticAttachments)) {
        const existing = sessionComposeStore.get(sid).optimistic;
        if (!existing.some((m) => m.id === optimisticId)) {
          sessionComposeActions.addOptimisticUserBubble(sid, {
            id: optimisticId,
            content: optimisticText,
            attachments: optimisticAttachments,
            createdAt: Date.now(),
          });
        }
      }
      void runStream({
        message: streamMessage,
        attachments: streamAttachments?.length ? streamAttachments : undefined,
        skillId: task.skillId,
        skillPrompt: task.skillPrompt,
        source: isAsyncResult
          ? "sub"
          : task.kind === "superior"
            ? (["super", "manager", "sub", "system"].includes(String(task.source))
                ? (task.source as "super" | "manager" | "sub" | "system")
                : "manager")
            : "user",
        toolResults: isAsyncResult
          ? {
              subagentResult: {
                jobId: task.jobId,
                subagentSessionId: task.subagentSessionId,
                subagentName: task.subagentName ?? `子 Agent ${task.jobId?.slice(0, 6) ?? ""}`,
                sourceType: task.sourceType,
                taskLabel: task.taskLabel,
              },
            }
          : undefined,
        optimisticUser: isAsyncResult ? undefined : { id: optimisticId, text: optimisticText },
        targetSessionId: sid === NEW_STREAM_KEY ? undefined : sid,
        keepCurrentView,
        agentId: streamAgentId,
      });
    })();
  }, [runStream, chatConfigModel, asyncResultQueue, effectiveSessionId, isSessionRunOccupied, consumeSessionQueueItemMutation, ackAsyncDeliveryMutation, utils.session.listRunning, asyncQueueQuery, sessionsItems, consumeRef]);

  /** 优先消费 preferredSessionId，再扫描其它有待消费项的 session（后台不抢视图） */
  const drainAllPendingQueues = useCallback(
    (preferredSessionId?: string) => {
      const viewSid = effectiveSessionId ?? NEW_STREAM_KEY;
      const ordered: string[] = [];
      const seen = new Set<string>();
      const push = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
      };
      if (preferredSessionId) push(preferredSessionId);
      push(viewSid);
      for (const id of sessionComposeStore.listSessionIds()) push(id);

      for (const sid of ordered) {
        const compose = sessionComposeStore.get(sid);
        // INV-2：streaming|done 均占用，跳过
        if (isSessionRunOccupied(sid) || compose.queueDraining) continue;
        const hasUser = compose.userQueue.some(
          (t) =>
            (t.kind === "user" || t.kind === "superior") &&
            (t.text.trim() || t.attachments?.length),
        );
        const asyncCandidates = sid === viewSid ? asyncResultQueue : compose.asyncOverlays;
        const hasAsync = asyncCandidates.some(
          (t) =>
            t.kind === "async-result" &&
            !t.serverConsumed &&
            !t.pinned &&
            (t.text.trim() || t.asyncResult),
        );
        if (!hasUser && !hasAsync) continue;
        consumeQueue(sid);
      }
    },
    [consumeQueue, effectiveSessionId, isSessionRunOccupied, asyncResultQueue],
  );

  return { drainAllPendingQueues };
}
