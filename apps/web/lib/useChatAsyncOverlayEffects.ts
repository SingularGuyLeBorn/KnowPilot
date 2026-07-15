"use client";

/**
 * useChatAsyncOverlayEffects —— 异步队列 overlay 域的三个 effect。
 *
 * 【异步 overlay 域】
 * 1. async-running overlay 出现 → 补一次 poll（防任务在 stats 轮询间隙完成而漏投）；
 * 2. 过期 async overlay 1s 节拍清理——独立 effect 保留：interval 若与
 *    asyncOverlays/consumedDeliveries 等高频 deps 合并会被反复 clear/重建而永不到点，
 *    故 deps 仅 [effectiveSessionId]；
 * 3. consumedDeliveries 按会话 localStorage 读写合一（原「切会话恢复 + 变化写回」
 *    两个 effect 归并：首轮恢复后 return 不写回，第二轮起走写回分支，
 *    消除原实现「切会话先写空集再写回水合值」的中间态）。
 */

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { type ChatQueueItem } from "@/lib/chatQueueTypes";

type AsyncQueueQuery = ReturnType<typeof trpc.agent.pullAsyncQueue.useQuery>;

export function useChatAsyncOverlayEffects(opts: {
  effectiveSessionId: string | null;
  asyncOverlays: ChatQueueItem[];
  consumedDeliveries: Set<string>;
  asyncQueueQuery: AsyncQueueQuery;
}) {
  const { effectiveSessionId, asyncOverlays, consumedDeliveries, asyncQueueQuery } = opts;

  // ① 当工具调用产生 async-running overlay 时立即触发一次 poll，防止任务在 stats 轮询间隙完成而漏投。
  // 无 jobId 的 spawn overlay 用 subagentSessionId / overlay.id 去重触发。
  const asyncPollTriggerRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!effectiveSessionId) return;
    const keys = asyncOverlays
      .filter(
        (o) =>
          o.kind === "async-running" &&
          (o.status === "running" || o.status === "queued"),
      )
      .map((o) => o.jobId || o.subagentSessionId || o.id);
    let shouldPoll = false;
    for (const key of keys) {
      if (!asyncPollTriggerRef.current.has(key)) {
        asyncPollTriggerRef.current.add(key);
        shouldPoll = true;
      }
    }
    if (shouldPoll) void asyncQueueQuery.refetch();
  }, [asyncOverlays, effectiveSessionId, asyncQueueQuery]);

  // ② 清理已过期的已完成 async overlay，让进度条稳定展示 5 秒后自动消失
  // （独立 effect：interval 不可与高频 deps 混，见文件头说明）
  useEffect(() => {
    if (!effectiveSessionId) return;
    const timer = setInterval(() => {
      const sid = effectiveSessionId;
      const current = sessionComposeStore.get(sid).asyncOverlays;
      const now = Date.now();
      const hasExpired = current.some((o) => o.kind === "async-result" && o.removeAt && o.removeAt <= now);
      if (hasExpired) {
        sessionComposeActions.patchAsyncOverlays(sid, (prev) =>
          prev.filter((o) => !(o.kind === "async-result" && o.removeAt && o.removeAt <= now)),
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveSessionId]);

  // ③ 按会话持久化已消费的异步投递，刷新页面后不再显示旧结果（读写合一）
  const consumedHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    if (consumedHydratedRef.current !== effectiveSessionId) {
      consumedHydratedRef.current = effectiveSessionId;
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          sessionComposeActions.setConsumedDeliveries(
            effectiveSessionId,
            new Set<string>(JSON.parse(saved)),
          );
          // 水合触发的 state 更新使本 effect 重跑，届时走下方写回分支
          return;
        }
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem(key, JSON.stringify([...consumedDeliveries]));
    } catch {
      // ignore
    }
  }, [effectiveSessionId, consumedDeliveries]);
}
