/**
 * 按 sessionId 刷新异步投递切片并写入 Compose overlays。
 * SSE / drain 必须走本函数，禁止用「焦点 session」偷换事件所属会话。
 */

import { trpc } from "@/lib/trpc";
import { mergeAsyncPollIntoQueue } from "@/lib/chatQueueTypes";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { streamLifecycleActions } from "@/lib/useStreamLifecycle";

type Utils = ReturnType<typeof trpc.useUtils>;

/** fetch pullAsyncQueue → setQueryData → merge 进该 session 的 asyncOverlays → hydrateDone */
export async function refreshSessionAsyncQueue(
  utils: Utils,
  sessionId: string,
): Promise<void> {
  if (!sessionId) return;
  const data = await utils.agent.pullAsyncQueue.fetch({ sessionId });
  utils.agent.pullAsyncQueue.setData({ sessionId }, data);
  const compose = sessionComposeStore.get(sessionId);
  const merged = mergeAsyncPollIntoQueue(compose.asyncOverlays, data, {
    skipDeliveryJobIds: compose.consumedDeliveries,
  });
  sessionComposeActions.setAsyncOverlays(sessionId, merged);
  streamLifecycleActions.hydrateDone(sessionId);
}

/** 同步：仅用 RQ 缓存 merge（drain 路径，不发网） */
export function mergeAsyncQueueFromCache(
  utils: Utils,
  sessionId: string,
): ReturnType<typeof mergeAsyncPollIntoQueue> {
  const compose = sessionComposeStore.get(sessionId);
  const poll = utils.agent.pullAsyncQueue.getData({ sessionId });
  return mergeAsyncPollIntoQueue(compose.asyncOverlays, poll, {
    skipDeliveryJobIds: compose.consumedDeliveries,
  });
}
