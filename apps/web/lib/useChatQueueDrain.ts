"use client";

/**
 * useChatQueueDrain —— 发送队列 drain 编排簇（W13e 从 chat.tsx 拆出）。
 *
 * 认领↔起流契约（架构不变量）：
 * - 软认领后只本地 detach（不出 tombstone）；起流 outcome=streamed 才 tombstone+finalize
 * - begin_rejected / busy_queued → unclaim + 恢复队列项（禁止 409/begin 拒后待发蒸发）
 * - failed（已起流）→ 不回滚认领，交 hub reconcileClaimsAfterRun / 超龄 release
 *
 * superior 不变量：kind=superior 仅由服务端 enqueueSuperiorQueueDrain 起流；
 * 前端若队首是 superior 则停。
 */

import { useCallback, type RefObject } from "react";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";

const logQueryCatch = catchUnlessCancelled("[useChatQueueDrain] query");
import { getModelOption } from "@/lib/chatConfig";
import { type ChatQueueItem, formatQueueItemForLlm, toApiAttachments } from "@/lib/chatQueueTypes";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { type RunStreamOptions, type RunStreamOutcome } from "@/lib/useChatRunStream";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";
import { getSessionConfig } from "@/lib/sessionConfigStore";

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

/** 本地出队但不 tombstone——失败可经 unclaim + SSE/merge 或显式 restore 回潮 */
function detachUserQueueItemLocal(sessionId: string, item: ChatQueueItem) {
  sessionComposeActions.patchUserQueue(sessionId, (q) =>
    q.filter((i) => i.id !== item.id && i.dbId !== item.dbId),
  );
}

function restoreUserQueueItem(sessionId: string, item: ChatQueueItem) {
  if (item.dbId) {
    sessionComposeActions.unmarkQueueDbIdConsumed(sessionId, item.dbId);
  }
  sessionComposeActions.patchUserQueue(sessionId, (q) => {
    if (q.some((i) => i.id === item.id || (item.dbId && i.dbId === item.dbId))) return q;
    return [...q, item];
  });
}

export interface UseChatQueueDrainParams {
  effectiveSessionId: string | null;
  /** 可见 pane 的 sessionId（分屏时两侧）；仅这些会话自动 drain */
  visibleSessionIds?: string[];
  isSessionRunOccupied: (sid: string | null) => boolean;
  sessionsItems: Array<{ id: string; agentId?: string | null }> | undefined;
  consumeSessionQueueItemMutation: ReturnType<typeof trpc.agent.consumeSessionQueueItem.useMutation>;
  finalizeSessionQueueItemMutation: ReturnType<typeof trpc.agent.finalizeSessionQueueItem.useMutation>;
  unclaimSessionQueueItemMutation: ReturnType<typeof trpc.agent.unclaimSessionQueueItem.useMutation>;
  runStream: (opts: RunStreamOptions) => Promise<RunStreamOutcome>;
  consumeRef: RefObject<(preferredSessionId?: string) => void>;
}

export function useChatQueueDrain({
  effectiveSessionId,
  visibleSessionIds,
  isSessionRunOccupied,
  sessionsItems,
  consumeSessionQueueItemMutation,
  finalizeSessionQueueItemMutation,
  unclaimSessionQueueItemMutation,
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

    let userReady: ChatQueueItem | undefined;
    for (const t of compose.userQueue) {
      // superior：服务端 FIFO drain 专属；队首是 superior 时前端停，绝不越过起流
      if (t.kind === "superior") break;
      if ((t.kind === "user" || t.kind === "child_notify") && isReady(t)) {
        userReady = t;
        break;
      }
    }
    const task = userReady;
    if (!task) return;

    if (task.kind === "superior" && sid === NEW_STREAM_KEY) {
      return;
    }

    const keepCurrentView = sid !== viewSid;
    const sessionMeta = (sessionsItems ?? []).find((s) => s.id === sid);
    const streamAgentId = sessionMeta?.agentId || undefined;

    sessionComposeActions.setQueueDraining(sid, true);

    (async () => {
      let softClaimedDbId: string | null = null;
      try {


      // E8：按被 drain 的 sessionId 取 model，禁止吃焦点 pane 闭包
      const drainModel = getSessionConfig(sid).model;
      const supportsVision = !!getModelOption(drainModel).supportsVision;

      if (task.kind === "user" || task.kind === "child_notify") {
        // child_notify 必须与 user 一样出队：旧实现落入 else 不 consume → 流结束后再发一遍
        const streamMessagePreview =
          formatQueueItemForLlm(task, supportsVision) ||
          (task.attachments?.length ? "（见附件）" : "");
        if (!streamMessagePreview.trim() && !task.attachments?.length) {
          // 空内容禁止起流（否则 LLM「像没接到」）——丢弃：tombstone + finalize
          sessionComposeActions.claimUserQueueItem(sid, task);
          detachUserQueueItemLocal(sid, task);
          if (task.dbId) {
            sessionComposeActions.markQueueDbIdConsumed(sid, task.dbId);
            utils.agent.listSessionQueueItems.setData({ sessionId: sid }, (old) =>
              Array.isArray(old) ? old.filter((i) => i.id !== task.dbId) : old,
            );
            try {
              const claim = await consumeSessionQueueItemMutation.mutateAsync({ id: task.dbId });
              if (claim.claimed) {
                await finalizeSessionQueueItemMutation.mutateAsync({ id: task.dbId });
              }
            } catch {
              /* ignore */
            }
          }
          sessionComposeActions.setQueueDraining(sid, false);
          return;
        }

        // 先软认领，再本地 detach（禁止先 tombstone——409/begin 拒后无法回潮）
        if (task.dbId) {
          try {
            const claim = await consumeSessionQueueItemMutation.mutateAsync({ id: task.dbId });
            if (!claim.claimed) {
              // 已经被服务端或其他端认领：移除本地队列项，防无限死循环重发
              detachUserQueueItemLocal(sid, task);
              sessionComposeActions.markQueueDbIdConsumed(sid, task.dbId);
              sessionComposeActions.setQueueDraining(sid, false);
              return;
            }
            softClaimedDbId = task.dbId;
            utils.agent.listSessionQueueItems.setData({ sessionId: sid }, (old) =>
              Array.isArray(old) ? old.filter((i) => i.id !== task.dbId) : old,
            );
          } catch {
            detachUserQueueItemLocal(sid, task);
            sessionComposeActions.setQueueDraining(sid, false);
            return;
          }
        }
        detachUserQueueItemLocal(sid, task);
      }

      const streamMessage =
        formatQueueItemForLlm(task, supportsVision) ||
        (task.attachments?.length ? "（见附件）" : "");
      const streamAttachments = toApiAttachments(task.attachments);
      const optimisticId = `opt-${task.id}`;
      const optimisticText = task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
      const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
      if (optimisticText || optimisticAttachments) {
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
      const outcome = await runStream({
        message: streamMessage,
        attachments: streamAttachments?.length ? streamAttachments : undefined,
        skillId: task.skillId,
        skillPrompt: task.skillPrompt,
        source: task.kind === "child_notify" ? "sub" : "user",
        toolResults:
          task.kind === "child_notify"
            ? { childNotify: { sourceName: task.sourceName, source: task.source } }
            : undefined,
        optimisticUser: { id: optimisticId, text: optimisticText },
        queueItemId: softClaimedDbId ?? task.dbId ?? undefined,
        targetSessionId: sid === NEW_STREAM_KEY ? undefined : sid,
        keepCurrentView,
        agentId: streamAgentId,
      });

      if (outcome.status === "streamed") {
        // 起流成功：tombstone 挡迟到 SSE + finalize 删行
        if ((task.kind === "user" || task.kind === "child_notify") && task.dbId) {
          sessionComposeActions.markQueueDbIdConsumed(sid, task.dbId);
          await finalizeSessionQueueItemMutation.mutateAsync({ id: task.dbId }).catch(logQueryCatch);
        }
      } else if (
        outcome.status === "begin_rejected" ||
        outcome.status === "busy_queued"
      ) {
        // 未真正起流：回滚认领 + 恢复待发
        if (softClaimedDbId) {
          await unclaimSessionQueueItemMutation.mutateAsync({ id: softClaimedDbId }).catch(logQueryCatch);
        }
        restoreUserQueueItem(sid, task);
        sessionComposeActions.removeOptimisticUserBubble(sid, optimisticId);
      } else if (outcome.status === "failed") {
        // 已起流后失败：不回滚认领（防双发）；乐观气泡清理
        sessionComposeActions.removeOptimisticUserBubble(sid, optimisticId);
      }
      } catch {
        /* claim / 拼装阶段抛错：回滚软认领 */
        if (softClaimedDbId) {
          await unclaimSessionQueueItemMutation.mutateAsync({ id: softClaimedDbId }).catch(logQueryCatch);
          restoreUserQueueItem(sid, task);
        }
      } finally {
        // 无论是否起流，必须释放 drain 锁。
        // 若起流成功，isSessionRunOccupied(sid) 会在流结束前挡住新并发；
        // 若流结束，isSessionRunOccupied 变 false，这里锁释放后才能继续 drain 下一项。
        sessionComposeActions.setQueueDraining(sid, false);
        // INV-8 ② 竞态兜底：onStreamCommitted 可能在 runStream promise resolve 之前触发，
        // 此时 queueDraining 仍为 true，drainAllPendingQueues 会跳过。
        // 释放锁后若 session 已 idle 且队列仍有可发项，必须再次触发 drain，否则待发消息永久卡住。
        // 这是「释放锁后检查工作」的标准模式，与 onStreamCommitted 双保险，非时序猜测补丁。
        const composeAfter = sessionComposeStore.get(sid);
        if (
          !isSessionRunOccupied(sid) &&
          composeAfter.userQueue.some(
            (t) =>
              (t.kind === "user" || t.kind === "child_notify") &&
              (t.text.trim() || t.attachments?.length),
          )
        ) {
          consumeRef.current(sid);
        }
      }
    })().catch(logQueryCatch);
  }, [runStream, effectiveSessionId, isSessionRunOccupied, consumeSessionQueueItemMutation, finalizeSessionQueueItemMutation, unclaimSessionQueueItemMutation, utils, sessionsItems, consumeRef]);

  /**
   * 优先 preferred，再可见 pane；不扫隐藏 tab（避免后台 tab 抢起流）。
   *
   * 注意：本函数只 drain `userQueue` / `child_notify` / `superior`。
   * `async-result` 不由前端 drain 消费——真实路径是服务端 `autoConsumeAsyncDelivery`
   * 认领 Task 后通过 `session_run_started` SSE 触发 `handleSessionRunStarted`，
   * 前端以 `isResume=true` 直接 `runStream` 起流。因此这里无需探测 async-result。
   */
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
        if (!hasUser) continue;
        consumeQueue(sid);
      }
    },
    [consumeQueue, effectiveSessionId, visibleSessionIds, isSessionRunOccupied],
  );

  return { drainAllPendingQueues };
}
