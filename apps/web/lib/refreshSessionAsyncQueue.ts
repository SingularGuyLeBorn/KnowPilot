/**
 * 按 sessionId 刷新异步投递切片并写入 Compose overlays。
 * SSE / drain 必须走本函数，禁止用「焦点 session」偷换事件所属会话。
 */

import { trpc } from "@/lib/trpc";
import { mergeAsyncPollIntoQueue } from "@/lib/chatQueueTypes";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { streamLifecycleActions } from "@/lib/useStreamLifecycle";
import { isCancelledOrAbortError } from "@/lib/trpc";

type Utils = ReturnType<typeof trpc.useUtils>;

/** fetch pullAsyncQueue → setQueryData → merge 进该 session 的 asyncOverlays → hydrateDone
 *  CancelledError 兜底：父子 Agent 通信时 SSE 事件密集触发并发 refetch 同一 queryKey，
 *  TanStack Query 取消未完成的旧 fetch 抛 CancelledError，此处静默吞掉（预期行为，非 bug），
 *  避免冒泡为 unhandled rejection 被 Next.js dev overlay 捕获显示。 */
export async function refreshSessionAsyncQueue(
  utils: Utils,
  sessionId: string,
): Promise<void> {
  if (!sessionId) return;
  let data: Awaited<ReturnType<typeof utils.agent.pullAsyncQueue.fetch>> | null = null;
  try {
    data = await utils.agent.pullAsyncQueue.fetch({ sessionId });
  } catch (err) {
    // CancelledError/AbortError（并发 refetch 取消旧 fetch）或网络瞬断：静默跳过，不阻塞 SSE 处理
    if (isCancelledOrAbortError(err)) return;
    console.warn(`[refreshSessionAsyncQueue] pullAsyncQueue.fetch 失败 session=${sessionId}:`, err);
    return;
  }
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
