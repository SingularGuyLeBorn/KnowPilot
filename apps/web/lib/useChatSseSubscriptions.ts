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
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";
import { mergeUserQueueFromDb } from "@/lib/chatQueueTypes";
import { refreshSessionAsyncQueue } from "@/lib/refreshSessionAsyncQueue";

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
  /** session_rotate focusNewSession=true 时调用，前端自动聚焦新会话 */
  onFocusSession?: (sessionId: string) => void;
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
  onFocusSession,
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

    /** 按事件所属 session 刷新切片；禁止一律刷 effectiveSessionId（后台 Tab 幽灵根因）
     *  CancelledError 兜底：并发 refetch 取消旧 fetch 抛错，.catch 静默避免 unhandled rejection */
    const refreshAsyncQueueFor = (targetSid: string) => {
      refreshSessionAsyncQueue(utils, targetSid).catch(() => {});
      // 焦点 query 缓存对齐（同 session 时 UI 立刻一致）
      if (targetSid === effectiveSessionId) {
        asyncQueueQuery.refetch().catch(() => {});
      }
      asyncQueueStatsQuery.refetch().catch(() => {});
    };

    const refreshAsync = (opts: { heavy?: boolean; sessionId: string }) => {
      refreshAsyncQueueFor(opts.sessionId);
      // heavy：终态才 invalidate 子会话列表 / task.list，避免 running 进度抖整批
      if (opts.heavy && mainSessionId) {
        utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 }).catch(() => {});
        utils.task.list.invalidate().catch(() => {});
      }
    };

    const cleanups: Array<() => void> = [];
    for (const sid of sessionIds) {
      // 确保该 session 已 watch（引用计数 +1），并注册额外事件监听
      sessionMessagesStore.watchSession(sid);
      const register = (eventType: string, handler: (ev: MessageEvent) => void) => {
        cleanups.push(sessionMessagesStore.addSessionEventListener(sid, eventType, handler));
      };

      register("async_delivery", (ev) => {
        let targetSid = sid;
        try {
          const data = JSON.parse(ev.data) as { sessionId?: string };
          if (data.sessionId) targetSid = data.sessionId;
        } catch {
          /* ignore */
        }
        refreshAsync({ heavy: true, sessionId: targetSid });
      });
      register("session_run_started", (ev) => {
        try {
          const data = JSON.parse(ev.data) as { sessionId?: string };
          utils.session.listRunning.invalidate().catch(() => {});
          refreshAsync({ heavy: true, sessionId: data.sessionId || sid });
          if (data.sessionId && data.sessionId !== sid) {
            sessionMessagesStore.watchSession(data.sessionId);
            extraWatchedSessionsRef.current.add(data.sessionId);
          }
        } catch {
          utils.session.listRunning.invalidate().catch(() => {});
          refreshAsync({ heavy: true, sessionId: sid });
        }
      });
      register("async_job_update", (ev) => {
        let status: string | undefined;
        let targetSid = sid;
        try {
          // stats 形状用服务端导出的 AsyncQueueStats（单一事实源），不再本地内联重复声明
          const data = JSON.parse(ev.data) as {
            stats?: AsyncQueueStats;
            status?: string;
            sessionId?: string;
          };
          status = data.status;
          if (data.sessionId) targetSid = data.sessionId;
          if (data.stats) {
            utils.agent.asyncQueueStats.setData(undefined, data.stats);
          }
        } catch {
          /* ignore parse */
        }
        const terminal =
          status === "done" || status === "failed" || status === "cancelled";
        refreshAsync({ heavy: terminal, sessionId: targetSid });
      });
      register("agent_message", () => {
        if (isSubagentSession) pullAgentMessagesQuery.refetch().catch(() => {});
      });
      register("subagent_session_update", (ev) => {
        if (mainSessionId) {
          utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 }).catch(() => {});
        }
        utils.session.listRunning.invalidate().catch(() => {});
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
            focusNewSession?: boolean;
          };
          if (data.oldSessionId && data.oldSessionId === effectiveSessionId) {
            setRotateBanner({ newSessionId: data.newSessionId, newTitle: data.newTitle });
          }
          utils.session.list.invalidate().catch(() => {});
          const invalidateId = data.oldSessionId ?? effectiveSessionId ?? undefined;
          if (invalidateId) {
            utils.session.getById.invalidate({ id: invalidateId }).catch(() => {});
          }
          // focusNewSession=true：agent 主动要求前端自动聚焦新会话（干净重启场景）
          if (data.focusNewSession && onFocusSession) {
            onFocusSession(data.newSessionId);
          }
        } catch {
          /* ignore */
        }
      });
      register("session_title_updated", () => {
        utils.session.list.invalidate().catch(() => {});
      });
      register("agent_renamed", () => {
        utils.agent.list.invalidate().catch(() => {});
      });
      register("session_queue_update", () => {
        // 按本 watch 的 sid 刷新（分屏两侧各自 merge）
        utils.agent.listSessionQueueItems
          .fetch({ sessionId: sid })
          .then((data) => {
            if (!data) return;
            utils.agent.listSessionQueueItems.setData({ sessionId: sid }, data);
            sessionComposeActions.patchUserQueue(sid, (q) =>
              mergeUserQueueFromDb(q, data, sessionComposeStore.get(sid).consumedQueueDbIds),
            );
            streamLifecycleActions.hydrateDone(sid);
          })
          .catch(() => {});
      });
      register("ask_user_pending", () => {
        utils.askUser.listPending.invalidate({ sessionId: sid }).catch(() => {});
      });
      register("ask_user_resolved", (ev) => {
        utils.askUser.listPending.invalidate({ sessionId: sid }).catch(() => {});
        // 邮件回复路径：把 answer 回填到 AskUserPrompt 的 customResponse 输入框（不创建气泡）
        try {
          const data = JSON.parse(ev.data) as { askId?: string; answer?: string; outcome?: string };
          if (data.askId && data.answer) {
            window.dispatchEvent(
              new CustomEvent("kp:ask-user-resolved", {
                detail: { askId: data.askId, answer: data.answer, outcome: data.outcome ?? "answered" },
              }),
            );
          }
        } catch {
          /* ignore */
        }
      });
      register("swarm_task_update", () => {
        // 父会话被动跟进 Swarm 任务态，少靠 task.list 盲轮询
        utils.task.list.invalidate().catch(() => {});
        utils.agent.asyncQueueStats.invalidate().catch(() => {});
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
    onFocusSession,
  ]);
}
