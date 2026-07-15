"use client";

/**
 * useChatDerivedQueues —— Chat 派生队列 memos（W13e 从 chat.tsx 拆出）。
 *
 * 两个物理独立队列：
 * - asyncResultQueue: 从 poll 数据派生（async-running + async-result），合并 asyncOverlays（用户追加编辑）
 * - userQueue: 用户主动发送的消息（存入 session state）
 * 显示队列 = asyncResultQueue + userQueue（async 在前，符合优先级语义）。
 * 右侧「状态」：未消费 = 仅待开始/运行中；已结束不进未消费；已消费带滑入。
 * 纯结构拆分：useMemo 体与 deps 逐字未改。本 hook 不含任何 useEffect。
 */

import { useMemo } from "react";
import {
  type ChatQueueItem,
  mergeAsyncPollIntoQueue,
  sortQueueItems,
} from "@/lib/chatQueueTypes";

// 服务端已消费 delivery 的元素形状 —— 单一事实源（W16b 单源化）：
// AsyncQueueData 与下方 runtimeConsumedItems 读取路径共用，取代原同文件两份内联 cast。
type ConsumedDelivery = {
  id: string;
  jobId: string;
  taskLabel: string;
  asyncResult: string;
  status: "done" | "failed";
  error?: string;
  subagentSessionId?: string;
  subagentName?: string;
  logs?: ChatQueueItem["logs"];
  createdAt: number;
  sourceType?: string;
};

// pullAsyncQueue 的 poll 数据：mergeAsyncPollIntoQueue 入参与 consumed 已消费列表的交叉
type AsyncQueueData = Parameters<typeof mergeAsyncPollIntoQueue>[1] & {
  consumed?: ConsumedDelivery[];
};

// 共享取值守卫：poll 数据可能为 undefined 或不含 consumed，统一兜底为空数组
function getConsumedDeliveries(data: AsyncQueueData | undefined): ConsumedDelivery[] {
  return data?.consumed ?? [];
}

export function useChatDerivedQueues({
  asyncOverlays,
  asyncQueueQuery,
  consumedDeliveries,
  userQueue,
}: {
  asyncOverlays: ChatQueueItem[];
  asyncQueueQuery: { data: AsyncQueueData | undefined };
  consumedDeliveries: Set<string>;
  userQueue: ChatQueueItem[];
}) {

  // 两个物理独立队列：
  // - asyncResultQueue: 从 poll 数据派生（async-running + async-result），合并 asyncOverlays（用户追加编辑）
  // - userQueue: 用户主动发送的消息（存入 session state）
  // 显示队列 = asyncResultQueue + userQueue（async 在前，符合优先级语义）
  const asyncResultQueue = useMemo(
    () =>
      mergeAsyncPollIntoQueue(asyncOverlays, asyncQueueQuery.data, {
        skipDeliveryJobIds: consumedDeliveries,
      }),
    [asyncOverlays, asyncQueueQuery.data, consumedDeliveries],
  );

  // 右侧「状态」：未消费 = 仅待开始/运行中；已结束不进未消费；已消费带滑入
  const runtimePendingItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-running"),
    [asyncResultQueue],
  );
  const runtimeHeldItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-result" && i.pinned),
    [asyncResultQueue],
  );
  const runtimeConsumedItems = useMemo(() => {
    const consumed = getConsumedDeliveries(asyncQueueQuery.data);
    return consumed.map((del): ChatQueueItem => ({
      id: `consumed-${del.jobId}`,
      kind: "async-result",
      text: "",
      jobId: del.jobId,
      taskLabel: del.taskLabel,
      asyncResult: del.status === "failed" ? `任务失败：${del.error || "未知错误"}` : del.asyncResult,
      status: del.status,
      subagentSessionId: del.subagentSessionId,
      subagentName: del.subagentName,
      logs: del.logs,
      createdAt: del.createdAt,
      sourceType: del.sourceType,
    }));
  }, [asyncQueueQuery.data]);

  const queue = useMemo(
    () => [...sortQueueItems(asyncResultQueue), ...sortQueueItems(userQueue)],
    [asyncResultQueue, userQueue],
  );

  return { asyncResultQueue, runtimePendingItems, runtimeHeldItems, runtimeConsumedItems, queue };
}
