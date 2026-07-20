"use client";

/**
 * useChatQueueDrain —— 发送队列 drain 编排簇（W13e 从 chat.tsx 拆出）。
 *
 * consumeQueue：从 async 结果队列 / 用户队列挑下一条就绪项，ACK/去重/乐观气泡后 runStream；
 * drainAllPendingQueues：优先消费 preferredSessionId，再扫描其它有待消费项的 session
 * （后台不抢视图）。
 *
 * superior 不变量：kind=superior 仅由服务端 enqueueSuperiorQueueDrain 起流；
 * 前端若队首是 superior 则停（不越过队首消费后续项，也不双跑）。
 * child_notify 与 user 一样：remove 本地 + consume DB 后再起流（修「消费后仍在队列 → 再发一遍」）。
 */

import { useCallback, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import { getModelOption } from "@/lib/chatConfig";
import { type ChatQueueItem, formatQueueItemForLlm } from "@/lib/chatQueueTypes";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { type RunStreamOptions } from "@/lib/useChatRunStream";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";

export type AckAsyncDeliveryFn = (input: { jobId: string }) => Promise<{ claimed: boolean }>;

/**
 * E1 不变量：仅在服务端 claimed:true 之后才 markDeliveryConsumed。
 * ACK 失败或未认领均不标记 → delivery 可再 merge 出现并再 claim。
 * 自检：删掉 catch 回滚，瞬态断网后结果仍能投递（因为根本没提前 mark）。
 */
export async function ackThenMarkDelivery(
  sessionId: string,
  jobId: string,
  ackFn: AckAsyncDeliveryFn,
): Promise<"claimed" | "not_claimed"> {
  const ack = await ackFn({ jobId });
  if (!ack.claimed) return "not_claimed";
  sessionComposeActions.markDeliveryConsumed(sessionId, jobId);
  return "claimed";
}

export interface UseChatQueueDrainParams {
  effectiveSessionId: string | null;
  /** 可见 pane 的 sessionId（分屏时两侧）；仅这些会话自动 drain */
  visibleSessionIds?: string[];
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
  visibleSessionIds,
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
    const visible = new Set(visibleSessionIds?.length ? visibleSessionIds : [viewSid]);
    const sid = targetSessionId ?? viewSid;
    const compose = sessionComposeStore.get(sid);
    // INV-2：streaming|done 均占用，禁止开新流
    if (isSessionRunOccupied(sid) || compose.queueDraining) return;

    const isReady = (t: ChatQueueItem) =>
      t.kind !== "async-running" &&
      (t.text.trim() || t.asyncResult || t.attachments?.length);

    // 可见 pane：用 poll 合并后的 asyncResultQueue（焦点）或本会话 overlays（分屏另一侧）
    // 不可见 tab：仅 overlays（后台续跑主要靠服务端 autoConsume）
    const asyncCandidates =
      sid === viewSid
        ? asyncResultQueue
        : visible.has(sid)
          ? compose.asyncOverlays
          : compose.asyncOverlays;

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
        // superior：服务端 FIFO drain 专属；队首是 superior 时前端停，绝不越过起流
        if (t.kind === "superior") break;
        if ((t.kind === "user" || t.kind === "child_notify") && isReady(t)) {
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
        try {
          // E1：claimed:true 之后才 mark（queueDraining 已防并发；提前 mark 无保护作用且 ACK 失败会永久 skip）
          const claim = await ackThenMarkDelivery(sid, task.jobId, (input) =>
            ackAsyncDeliveryMutation.mutateAsync(input),
          );
          if (claim === "not_claimed") {
            sessionComposeActions.setQueueDraining(sid, false);
            void utils.session.listRunning.invalidate();
            if (sid === viewSid) void asyncQueueQuery.refetch();
            // 已释放 drain 锁且在 async 续体内（调用栈已 unwind），直接重试下一项
            consumeRef.current(sid);
            return;
          }
        } catch {
          // 未 mark；若防御性误 mark 过则回滚（当前路径不会）
          sessionComposeActions.unmarkDeliveryConsumed(sid, task.jobId);
          sessionComposeActions.setQueueDraining(sid, false);
          return;
        }
      }

      if (task.kind === "user" || task.kind === "child_notify") {
        // child_notify 必须与 user 一样出队：旧实现落入 else 不 consume → 流结束后再发一遍
        const streamMessagePreview =
          formatQueueItemForLlm(task, !!getModelOption(chatConfigModel).supportsVision) ||
          (task.attachments?.length ? "（见附件）" : "");
        if (!streamMessagePreview.trim() && !task.attachments?.length) {
          // 空内容禁止起流（否则 LLM「像没接到」）
          sessionComposeActions.removeUserQueueItem(sid, task.id);
          if (task.dbId) {
            try {
              await consumeSessionQueueItemMutation.mutateAsync({ id: task.dbId });
            } catch {
              /* ignore */
            }
          }
          sessionComposeActions.setQueueDraining(sid, false);
          consumeRef.current(sid);
          return;
        }

        sessionComposeActions.removeUserQueueItem(sid, task.id);
        if (task.dbId) {
          try {
            const claim = await consumeSessionQueueItemMutation.mutateAsync({ id: task.dbId });
            if (!claim.claimed) {
              sessionComposeActions.setQueueDraining(sid, false);
              consumeRef.current(sid);
              return;
            }
          } catch {
            sessionComposeActions.setQueueDraining(sid, false);
            return;
          }
        }
      } else if (task.kind === "async-result") {
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
          : task.kind === "child_notify"
            ? "sub"
            : "user",
        toolResults: isAsyncResult
          ? {
              subagentResult: {
                jobId: task.jobId,
                subagentSessionId: task.subagentSessionId,
                subagentName: task.subagentName ?? "子 Agent",
                sourceType: task.sourceType,
                taskLabel: task.taskLabel,
              },
            }
          : task.kind === "child_notify"
            ? { childNotify: { sourceName: task.sourceName, source: task.source } }
            : undefined,
        optimisticUser: isAsyncResult ? undefined : { id: optimisticId, text: optimisticText },
        targetSessionId: sid === NEW_STREAM_KEY ? undefined : sid,
        keepCurrentView,
        agentId: streamAgentId,
      });
    })();
  }, [runStream, chatConfigModel, asyncResultQueue, effectiveSessionId, visibleSessionIds, isSessionRunOccupied, consumeSessionQueueItemMutation, ackAsyncDeliveryMutation, utils.session.listRunning, asyncQueueQuery, sessionsItems, consumeRef]);

  /** 优先 preferred，再可见 pane；不扫隐藏 tab（避免后台 tab 抢起流） */
  const drainAllPendingQueues = useCallback(
    (preferredSessionId?: string) => {
      const viewSid = effectiveSessionId ?? NEW_STREAM_KEY;
      const visible = visibleSessionIds?.length
        ? visibleSessionIds
        : [viewSid].filter((id) => id && id !== NEW_STREAM_KEY);
      const ordered: string[] = [];
      const seen = new Set<string>();
      const push = (id: string) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
      };
      if (preferredSessionId) push(preferredSessionId);
      for (const id of visible) push(id);
      // 新对话（无 sessionId）：焦点为空时 viewSid/preferred 均为 NEW_STREAM_KEY
      if (
        preferredSessionId === NEW_STREAM_KEY ||
        viewSid === NEW_STREAM_KEY ||
        (!effectiveSessionId && !visible.length)
      ) {
        push(NEW_STREAM_KEY);
      }

      for (const sid of ordered) {
        const compose = sessionComposeStore.get(sid);
        // INV-2：streaming|done 均占用，跳过
        if (isSessionRunOccupied(sid) || compose.queueDraining) continue;
        // superior 在队首时前端不 drain（服务端负责）；仅探测 user/child_notify
        let blockedBySuperior = false;
        const hasUser = compose.userQueue.some((t) => {
          if (t.kind === "superior") {
            blockedBySuperior = true;
            return false;
          }
          if (blockedBySuperior) return false;
          return (
            (t.kind === "user" || t.kind === "child_notify") &&
            (t.text.trim() || t.attachments?.length)
          );
        });
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
    [consumeQueue, effectiveSessionId, visibleSessionIds, isSessionRunOccupied, asyncResultQueue],
  );

  return { drainAllPendingQueues };
}
