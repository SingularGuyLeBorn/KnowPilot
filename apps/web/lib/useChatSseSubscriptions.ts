"use client";

/**
 * useChatSseSubscriptions —— SSE 订阅与事件分发心脏区（W13e 从 chat.tsx 拆出）。
 *
 * 推优先：通过 store 统一监听 async-stream SSE（当前会话 + 父会话）。不自建 EventSource——
 * 复用 useSessionMessages 的 watchSession 连接，消除双连接浪费。事件回调里 watchSession 的
 * 子 Agent session 在 cleanup 时统一 close。纯结构拆分：effect 体逐字未改（8 类事件
 * 注册/分发中枢，cleanup 的 closeSessionWatch 引用计数时序不可动），deps 仅追加注入的
 * setRotateBanner（setState identity 恒定，行为等价）。本 hook 在 ChatView 的调用位置即
 * 原 effect 声明位置，hooks 挂载顺序与 effect 执行时序完全不变。
 */

import { useEffect, useRef } from "react";
import type { AsyncQueueStats } from "@knowpilot/server";
import { trpc } from "@/lib/trpc";
import { sessionMessagesStore } from "@/lib/useSessionMessages";
import { streamLifecycleActions } from "@/lib/useStreamLifecycle";
import { sessionComposeActions } from "@/lib/useSessionComposeState";
import { mergeUserQueueFromDb } from "@/lib/chatQueueTypes";

export interface UseChatSseSubscriptionsParams {
  effectiveSessionId: string | null;
  mainSessionId: string | null;
  /** 打开的标签 / 可见 pane；切 tab 不关闭仍 open 的 watch */
  watchedSessionIds?: string[];
  backendDown: boolean;
  asyncQueueQuery: ReturnType<typeof trpc.agent.pullAsyncQueue.useQuery>;
  asyncQueueStatsQuery: ReturnType<typeof trpc.agent.asyncQueueStats.useQuery>;
  pullAgentMessagesQuery: ReturnType<typeof trpc.agent.pullAgentMessages.useQuery>;
  isSubagentSession: boolean;
  setRotateBanner: (banner: { newSessionId: string; newTitle: string } | null) => void;
}

export function useChatSseSubscriptions({
  effectiveSessionId,
  mainSessionId,
  watchedSessionIds,
  backendDown,
  asyncQueueQuery,
  asyncQueueStatsQuery,
  pullAgentMessagesQuery,
  isSubagentSession,
  setRotateBanner,
}: UseChatSseSubscriptionsParams) {
  const utils = trpc.useUtils();

  const extraWatchedSessionsRef = useRef<Set<string>>(new Set());
  const watchedKey = (watchedSessionIds ?? []).filter(Boolean).sort().join(",");
  useEffect(() => {
    if (backendDown) return;
    const sessionIds = new Set<string>();
    if (effectiveSessionId) sessionIds.add(effectiveSessionId);
    if (mainSessionId) sessionIds.add(mainSessionId);
    for (const id of watchedKey ? watchedKey.split(",") : []) {
      if (id) sessionIds.add(id);
    }
    if (sessionIds.size === 0) return;
    // 捕获 ref 值到 effect 局部变量，避免 cleanup 时 ref 已变更（react-hooks/exhaustive-deps）
    const extraWatched = extraWatchedSessionsRef.current;

    const refreshAsync = () => {
      // INV-8 ④：异步队列刷新完成（async_delivery / async_job_update / session_run_started 触发）
      // = 显式 drain 请求。投递到达时视图空闲则立即消费；占用中由 commit 兑底。
      // 注意：完成态展示不在这里做——poll 显示 job 已被服务端消费时，由
      // mergeAsyncPollIntoQueue 纯派生把本地 overlay 转为 done/failed（createdAt+15s），
      // 覆盖初始 fetch / refetch / SSE 全部数据到达路径，不依赖哪个事件先到。
      void asyncQueueQuery.refetch().then(() => {
        if (effectiveSessionId) streamLifecycleActions.hydrateDone(effectiveSessionId);
      });
      void asyncQueueStatsQuery.refetch();
      if (mainSessionId) {
        void utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 });
        void utils.task.list.invalidate();
        if (mainSessionId !== effectiveSessionId) {
          void utils.agent.pullAsyncQueue.invalidate({ sessionId: mainSessionId });
        }
      }
    };

    const cleanups: Array<() => void> = [];
    for (const sid of sessionIds) {
      // 确保该 session 已 watch（引用计数 +1），并注册额外事件监听
      sessionMessagesStore.watchSession(sid);
      const register = (eventType: string, handler: (ev: MessageEvent) => void) => {
        cleanups.push(sessionMessagesStore.addSessionEventListener(sid, eventType, handler));
      };

      register("async_delivery", refreshAsync);
      register("session_run_started", (ev) => {
        try {
          const data = JSON.parse(ev.data) as { sessionId?: string };
          void utils.session.listRunning.invalidate();
          refreshAsync();
          if (data.sessionId && data.sessionId !== sid) {
            sessionMessagesStore.watchSession(data.sessionId);
            extraWatchedSessionsRef.current.add(data.sessionId);
          }
        } catch {
          void utils.session.listRunning.invalidate();
          refreshAsync();
        }
      });
      register("async_job_update", (ev) => {
        try {
          // stats 形状用服务端导出的 AsyncQueueStats（单一事实源），不再本地内联重复声明
          const data = JSON.parse(ev.data) as { stats?: AsyncQueueStats };
          if (data.stats) {
            utils.agent.asyncQueueStats.setData(undefined, data.stats);
          }
        } catch {
          /* ignore parse */
        }
        refreshAsync();
      });
      register("agent_message", () => {
        if (isSubagentSession) void pullAgentMessagesQuery.refetch();
      });
      register("subagent_session_update", (ev) => {
        if (mainSessionId) {
          void utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 });
        }
        void utils.session.listRunning.invalidate();
        try {
          const data = JSON.parse(ev.data) as {
            subagentSessionId?: string;
            status?: string;
          };
          if (data.subagentSessionId && data.subagentSessionId !== sid) {
            sessionMessagesStore.watchSession(data.subagentSessionId);
            extraWatchedSessionsRef.current.add(data.subagentSessionId);
          }
        } catch {
          /* ignore */
        }
      });
      register("session_rotated", (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            oldSessionId?: string;
            newSessionId: string;
            newTitle: string;
          };
          if (data.oldSessionId && data.oldSessionId === effectiveSessionId) {
            setRotateBanner({ newSessionId: data.newSessionId, newTitle: data.newTitle });
          }
          void utils.session.list.invalidate();
          const invalidateId = data.oldSessionId ?? effectiveSessionId ?? undefined;
          if (invalidateId) {
            void utils.session.getById.invalidate({ id: invalidateId });
          }
        } catch {
          /* ignore */
        }
      });
      register("session_title_updated", () => {
        void utils.session.list.invalidate();
      });
      register("agent_renamed", () => {
        void utils.agent.list.invalidate();
      });
      register("session_queue_update", () => {
        // 按本 watch 的 sid 刷新（分屏两侧各自 merge）
        void utils.agent.listSessionQueueItems
          .fetch({ sessionId: sid })
          .then((data) => {
            if (!data) return;
            utils.agent.listSessionQueueItems.setData({ sessionId: sid }, data);
            sessionComposeActions.patchUserQueue(sid, (q) => mergeUserQueueFromDb(q, data));
            streamLifecycleActions.hydrateDone(sid);
          });
      });
    }
    return () => {
      for (const fn of cleanups) fn();
      for (const sid of sessionIds) {
        sessionMessagesStore.closeSessionWatch(sid);
      }
      // 清理事件回调里动态 watch 的子 Agent session
      for (const sid of extraWatched) {
        sessionMessagesStore.closeSessionWatch(sid);
      }
      extraWatched.clear();
    };
  }, [
    effectiveSessionId,
    mainSessionId,
    watchedKey,
    backendDown,
    asyncQueueQuery,
    asyncQueueStatsQuery,
    pullAgentMessagesQuery,
    isSubagentSession,
    utils,
    setRotateBanner,
  ]);
}
