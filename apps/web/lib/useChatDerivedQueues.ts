"use client";

/**
 * useChatDerivedQueues —— Chat 派生队列 memos（W13e 从 chat.tsx 拆出）。
 *
 * 不变量：
 * - asyncResultQueue 与 userQueue 物理隔离；显示队列 = async 在前 + user 在后。
 * - 右栏「状态」两级分组：异步队列按 TP-3 执行×消费三态分组；同步任务（deliverToQueue=false）仅透传展示。
 * - 已消费列表以服务端 poll.consumed 为唯一事实源。
 */

import { useMemo } from "react";
import {
  type ChatQueueItem,
  type SyncTaskItem,
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
  /** W-A 同步任务（deliverToQueue=false）：只展示，纯透传 */
  syncTasks?: SyncTaskItem[];
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
  const asyncResultQueue = useMemo(
    () =>
      mergeAsyncPollIntoQueue(asyncOverlays, asyncQueueQuery.data, {
        skipDeliveryJobIds: consumedDeliveries,
      }),
    [asyncOverlays, asyncQueueQuery.data, consumedDeliveries],
  );

  const runtimeActiveItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-running"),
    [asyncResultQueue],
  );
  const runtimeToConsumeItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-result" && !i.removeAt && !i.serverConsumed),
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

  // 右栏「同步任务」：deliverToQueue=false 的任务，纯透传只展示（无 pin/消费/气泡发送）
  const syncTaskItems = useMemo(
    () => asyncQueueQuery.data?.syncTasks ?? [],
    [asyncQueueQuery.data],
  );

  return { asyncResultQueue, runtimeActiveItems, runtimeToConsumeItems, runtimeConsumedItems, queue, syncTaskItems };
}
