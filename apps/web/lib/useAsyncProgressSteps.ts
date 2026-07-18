"use client";

/**
 * useAsyncProgressSteps —— 异步任务进度时间线的纯数据派生（W13c 从 chatSidebar.tsx 拆出）。
 *
 * 父会话实时任务进度：从合并后的 asyncResultQueue 派生，
 * async_task_run / spawn_subagent 返回 running 时立即显示，
 * 任务完成后显示 done/failed，展示窗口结束后自动消失
 * （store overlay 由 removeAt 定时器清理；纯派生项随 overlay 15s 生命周期过期不再派生）。
 * 完成态转换由两条互斥路径保证，显示不依赖谁赢得原子 CLAIM 竞态：
 * ① 前端 consume 赢得 CLAIM → consumeQueue 内 patchAsyncOverlays 转完成态（removeAt=now+5s）；
 * ② 服务端 autoConsume 赢得 CLAIM → mergeAsyncPollIntoQueue 纯派生转换
 *    （serverConsumed 展示项，removeAt=createdAt+15s，覆盖初始 fetch/refetch/SSE 全部数据路径）。
 */

import { useMemo } from "react";
import { type TimelineStep } from "@/lib/chatMessageUtils";
import { type ChatQueueItem } from "@/lib/chatQueueTypes";

export function useAsyncProgressSteps(asyncResultQueue: ChatQueueItem[]): TimelineStep[] {
  return useMemo<TimelineStep[]>(() => {
    const steps: TimelineStep[] = [];
    for (const item of asyncResultQueue) {
      const latestLog = item.logs?.length ? item.logs[item.logs.length - 1] : undefined;
      if (item.kind === "async-running") {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || "后台任务",
          round: 1,
          status: item.status === "queued" ? "queued" : "running",
          content: latestLog?.message,
        });
      } else if (item.kind === "async-result" && item.status) {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || "后台任务",
          round: 1,
          status: item.status === "failed" ? "failed" : "done",
          content: item.status === "failed" ? item.asyncResult : latestLog?.message,
        });
      }
    }
    return steps;
  }, [asyncResultQueue]);
}
