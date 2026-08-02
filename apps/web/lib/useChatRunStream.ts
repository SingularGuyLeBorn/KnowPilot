"use client";

/**
 * useChatRunStream —— runStream 流式编排内核（W13e 从 chat.tsx 拆出）。
 *
 * 包含：saveChatStoresToStorage（lifecycle/compose 双 store 序列化持久化）、
 * scheduleStreamSave（防抖落盘）、流式 token rAF 合帧三件套
 * （scheduleStreamFlush / flushStreamNow / discardStreamFlush）与 runStream 本体。
 * 纯结构拆分：useCallback 体逐字未改；deps 数组在原有序列后追加了注入的 refs/setters
 * （ref 对象与 setState 的 identity 恒定，追加项永不触发 useCallback 重建，行为完全等价）；
 * rAF/定时器 refs 仍归 chat.tsx 所有（其 unmount 清理 effect 统一回收），经参数注入；
 * 本 hook 不新增任何 useEffect。INV-1~8 与 drain 链语义不变。
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { useRouter, useSearchParams } from "next/navigation";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { SessionBusyQueuedError, streamAgentChat } from "@/lib/agentStream";
import { buildStreamConfig } from "@/lib/chatConfig";
import { formatToolResultHint, pruneEmptyThinkingSteps } from "@/lib/chatMessageUtils";
import { type Agent, type ChatAttachment, DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import { COMPOSE_STORAGE_KEY, LIFECYCLE_STORAGE_KEY, NEW_STREAM_KEY } from "@/lib/chatKeys";
import {
  ensureSessionConfigHydrated,
  getSessionConfig,
  migrateSessionConfig,
  patchSessionConfig,
} from "@/lib/sessionConfigStore";
import { sessionMessagesStore } from "@/lib/useSessionMessages";
import { streamLifecycleActions, streamLifecycleStore } from "@/lib/useStreamLifecycle";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";

const logQueryCatch = catchUnlessCancelled("[useChatRunStream] query");

export function saveChatStoresToStorage() {
  try {
    const life = streamLifecycleStore.serialize();
    delete life[NEW_STREAM_KEY];
    sessionStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify(life));
    const compose = sessionComposeStore.serialize();
    delete compose[NEW_STREAM_KEY];
    sessionStorage.setItem(COMPOSE_STORAGE_KEY, JSON.stringify(compose));
  } catch (err) {
    console.warn("[useChatRunStream] saveChatStoresToStorage failed:", err);
  }
}

export type RunStreamOptions = {
  message?: string;
  /** 已是 API 形态（图片无本地 id；文章 type:post） */
  attachments?: ChatAttachment[];
  regenerate?: boolean;
  regenerateUserMessageId?: string;
  retryFromMessageId?: string;
  editMessageId?: string;
  editContent?: string;
  skillId?: string;
  skillPrompt?: string;
  source?: "user" | "super" | "manager" | "sub" | "system";
  toolResults?: Record<string, unknown>;
  optimisticUser?: { id: string; text: string };
  /** 发送队列项 id：busy 时服务端按此 unclaim */
  queueItemId?: string;
  resumeAfter?: number;
  isResume?: boolean;
  targetSessionId?: string;
  /** 后台消费队列时：不抢占当前视图 / URL */
  keepCurrentView?: boolean;
  /** 覆盖 agentId（后台消费其它 session 时用该 session 的 Agent） */
  agentId?: string;
};

/** drain 认领↔起流契约：只有 streamed 才 finalize；busy/begin_rejected 必须回滚认领 */
export type RunStreamOutcome =
  | { status: "streamed" }
  | { status: "begin_rejected" }
  | { status: "busy_queued"; queueItemId: string | null }
  | { status: "failed" };

export interface UseChatRunStreamParams {
  effectiveSessionId: string | null;
  effectiveAgentId: string;
  selectedWorkspaceId: string | null;
  selectedAgent: Agent | undefined;
  createSessionQueueItemMutation: ReturnType<typeof trpc.agent.createSessionQueueItem.useMutation>;
  /** 仅 resume 无流等无法靠 SSE upsert 对齐的路径使用；abort 有 partialId 时禁止调用 */
  hydrateSessionMessagesFallback: (sid: string) => Promise<void>;
  // rAF/定时器/视图 refs：归 chat.tsx 所有（unmount 清理 effect 统一回收），运行时注入
  effectiveSessionIdRef: RefObject<string | null>;
  isPageUnloadingRef: RefObject<boolean>;
  pendingStreamDeltaRef: RefObject<Map<string, string>>;
  streamRafRef: RefObject<Map<string, number>>;
  pendingThinkingDeltaRef: RefObject<Map<string, string>>;
  thinkingRafRef: RefObject<Map<string, number>>;
  streamSaveTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  setSessionId: (id: string | null) => void;
  searchParams: ReturnType<typeof useSearchParams>;
  pathname: string;
  router: ReturnType<typeof useRouter>;
  runStreamRef?: RefObject<((opts: RunStreamOptions) => Promise<RunStreamOutcome>) | null>;
}

export function useChatRunStream({
  effectiveSessionId,
  effectiveAgentId,
  selectedWorkspaceId,
  selectedAgent,
  createSessionQueueItemMutation,
  hydrateSessionMessagesFallback,
  effectiveSessionIdRef,
  isPageUnloadingRef,
  pendingStreamDeltaRef,
  streamRafRef,
  pendingThinkingDeltaRef,
  thinkingRafRef,
  streamSaveTimeoutRef,
  setSessionId,
  searchParams,
  pathname,
  router,
  runStreamRef,
}: UseChatRunStreamParams) {
  const utils = trpc.useUtils();

  const scheduleStreamSave = useCallback((immediate?: boolean) => {
    if (streamSaveTimeoutRef.current) clearTimeout(streamSaveTimeoutRef.current);
    if (immediate) {
      saveChatStoresToStorage();
      return;
    }
    // 流式期勿每 100ms JSON.stringify 全文；1.5s 节流足够崩溃恢复，done/visibility 仍走 immediate
    streamSaveTimeoutRef.current = setTimeout(() => {
      saveChatStoresToStorage();
      streamSaveTimeoutRef.current = null;
    }, 1_500);
  }, [streamSaveTimeoutRef]);

  const scheduleStreamFlush = useCallback((sid: string) => {
    if (streamRafRef.current.has(sid)) return;
    const id = requestAnimationFrame(() => {
      streamRafRef.current.delete(sid);
      const delta = pendingStreamDeltaRef.current.get(sid);
      if (delta) {
        pendingStreamDeltaRef.current.delete(sid);
        streamLifecycleActions.appendTokenDelta(sid, delta);
        scheduleStreamSave();
      }
    });
    streamRafRef.current.set(sid, id);
  }, [scheduleStreamSave, pendingStreamDeltaRef, streamRafRef]);

  /** 与 pendingThinkingDelta 同步的 round，flush 时写入正确轮次 */
  const pendingThinkingRoundRef = useRef<Map<string, number>>(new Map());

  const scheduleThinkingFlush = useCallback((sid: string) => {
    if (thinkingRafRef.current.has(sid)) return;
    const id = requestAnimationFrame(() => {
      thinkingRafRef.current.delete(sid);
      const delta = pendingThinkingDeltaRef.current.get(sid);
      if (delta) {
        pendingThinkingDeltaRef.current.delete(sid);
        const round = pendingThinkingRoundRef.current.get(sid) ?? 1;
        pendingThinkingRoundRef.current.delete(sid);
        streamLifecycleActions.appendThinkingDelta(sid, delta, round);
        scheduleStreamSave();
      }
    });
    thinkingRafRef.current.set(sid, id);
  }, [scheduleStreamSave, pendingThinkingDeltaRef, thinkingRafRef]);

  /** 立即冲刷并取消该 session 的待写 delta */
  const flushStreamNow = useCallback((sid: string) => {
    const rafId = streamRafRef.current.get(sid);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      streamRafRef.current.delete(sid);
    }
    const delta = pendingStreamDeltaRef.current.get(sid);
    if (delta) {
      pendingStreamDeltaRef.current.delete(sid);
      streamLifecycleActions.appendTokenDelta(sid, delta);
      scheduleStreamSave();
    }
    const thinkRaf = thinkingRafRef.current.get(sid);
    if (thinkRaf !== undefined) {
      cancelAnimationFrame(thinkRaf);
      thinkingRafRef.current.delete(sid);
    }
    const thinkDelta = pendingThinkingDeltaRef.current.get(sid);
    if (thinkDelta) {
      pendingThinkingDeltaRef.current.delete(sid);
      const round = pendingThinkingRoundRef.current.get(sid) ?? 1;
      pendingThinkingRoundRef.current.delete(sid);
      streamLifecycleActions.appendThinkingDelta(sid, thinkDelta, round);
      scheduleStreamSave();
    }
  }, [scheduleStreamSave, pendingStreamDeltaRef, streamRafRef, pendingThinkingDeltaRef, thinkingRafRef]);

  /** 取消该 session 的 rAF 并丢弃未写 delta */
  const discardStreamFlush = useCallback((sid: string) => {
    const rafId = streamRafRef.current.get(sid);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      streamRafRef.current.delete(sid);
    }
    pendingStreamDeltaRef.current.delete(sid);
    const thinkRaf = thinkingRafRef.current.get(sid);
    if (thinkRaf !== undefined) {
      cancelAnimationFrame(thinkRaf);
      thinkingRafRef.current.delete(sid);
    }
    pendingThinkingDeltaRef.current.delete(sid);
    pendingThinkingRoundRef.current.delete(sid);
  }, [pendingStreamDeltaRef, streamRafRef, pendingThinkingDeltaRef, thinkingRafRef]);

  const runStream = useCallback(
    async (opts: RunStreamOptions): Promise<RunStreamOutcome> => {
      // 捕获本次流式所属的 session（新会话首条消息时为 NEW_STREAM_KEY，onDone 拿到 sessionId 后迁移）
      let originSid = opts.targetSessionId ?? effectiveSessionId ?? NEW_STREAM_KEY;
      // 视图不变量：流回调不依赖闭包 keepCurrentView，改用 effectiveSessionIdRef 运行时判断
      // keepCurrentView 参数仅保留给 consumeQueue 标记后台消费，不再在回调里使用
      const isResume = opts.isResume === true;
      // RESUME 单飞：续传不得 abort 已有 SSE；claim CAS 堵住双路同时见 null 互盖。
      // 新开流才 abort 旧 controller 再挂新 AC；已 abort 的陈旧 AC 允许 resume 替换。
      const ac = new AbortController();
      if (isResume) {
        if (!sessionComposeActions.claimActiveAbortController(originSid, ac)) {
          return { status: "begin_rejected" };
        }
      } else {
        sessionComposeActions.getActiveAbortController(originSid)?.abort();
        sessionComposeActions.setActiveAbortController(originSid, ac);
      }
      /** 当前 ReAct 轮次：thinking delta 必须写入对应 round，禁止糊到上一轮 */
      let streamRound = 1;

      const began = streamLifecycleActions.beginStream(originSid, {
        streamTargetUserId:
          opts.retryFromMessageId ?? opts.regenerateUserMessageId ?? opts.editMessageId ?? null,
        resume: isResume,
      });
      // INV-2 / RESUME_CLAIM：begin 被拒（占用中或 resume 双挂）则禁止继续发请求
      if (!began) {
        // 仅清掉我们刚挂上的 controller；勿 abort（resume 双挂时可能与在途流无关）
        if (sessionComposeActions.getActiveAbortController(originSid) === ac) {
          sessionComposeActions.setActiveAbortController(originSid, null);
        }
        sessionComposeActions.setQueueDraining(originSid, false);
        return { status: "begin_rejected" };
      }
      scheduleStreamSave(true);

      // E8：运行时按 originSid 取权威 config，禁止吃 React 闭包首帧 DEFAULT / 错 pane
      const runtimeConfig = ensureSessionConfigHydrated(originSid);
      // E8：后台 drain 非焦点 session 时，必须用目标 session 所属 Agent 的 systemPrompt。
      // sessionConfigStore 在会话创建/迁移时已写入 agentSystemPrompt；无则回退到焦点 selectedAgent。
      const fallbackSystemPrompt = runtimeConfig.agentSystemPrompt?.trim()
        ? runtimeConfig.agentSystemPrompt
        : selectedAgent?.systemPrompt;
      const streamConfig = buildStreamConfig(
        {
          ...runtimeConfig,
          ...(opts.skillPrompt
            ? { systemPrompt: opts.skillPrompt, customSystemPrompt: true }
            : {}),
        },
        fallbackSystemPrompt ? { systemPrompt: fallbackSystemPrompt } : undefined,
      );

      try {
        await streamAgentChat(
          {
            sessionId: opts.targetSessionId ?? effectiveSessionId ?? undefined,
            agentId: opts.agentId || effectiveAgentId || undefined,
            message: isResume ? undefined : opts.message,
            resumeAfter: opts.resumeAfter,
            attachments: opts.attachments,
            regenerate: opts.regenerate,
            regenerateUserMessageId: opts.regenerateUserMessageId,
            retryFromMessageId: opts.retryFromMessageId,
            editMessageId: opts.editMessageId,
            editContent: opts.editContent,
            skillId: opts.skillId,
            source: opts.source,
            toolResults: opts.toolResults,
            clientMessageId: opts.optimisticUser?.id,
            queueItemId: opts.queueItemId,
            ...streamConfig,
          },
          {
            onSessionStart: (sid) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                flushStreamNow(NEW_STREAM_KEY);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                migrateSessionConfig(NEW_STREAM_KEY, sid);
                originSid = sid;
                // 新会话首条消息期间入队的项尚无 dbId，迁移后补写 DB
                const pending = sessionComposeStore.get(sid).userQueue;
                for (const item of pending) {
                  if (item.dbId || (item.kind !== "user" && item.kind !== "superior")) continue;
                  const localId = item.id;
                  createSessionQueueItemMutation
                    .mutateAsync({
                      sessionId: sid,
                      kind: item.kind === "superior" ? "superior" : "user",
                      content: item.text,
                      source: item.source ?? "user",
                      sourceName: item.sourceName,
                      agentMessageId: item.agentMessageId,
                      attachments: item.attachments,
                      skillId: item.skillId,
                      skillPrompt: item.skillPrompt,
                    })
                    .then(async (res) => {
                      const dbId = (res as { data?: { id?: string } })?.data?.id;
                      if (!dbId) return;
                      const stillQueued = sessionComposeStore
                        .get(sid)
                        .userQueue.some((i) => i.id === localId);
                      if (!stillQueued) {
                        // 本地项已被 drain：删孤儿行，避免「待发」幽灵
                        await utils.client.agent.deleteSessionQueueItem
                          .mutate({ id: dbId })
                          .catch(logQueryCatch);
                        return;
                      }
                      sessionComposeActions.patchUserQueue(sid, (q) =>
                        q.map((i) => (i.id === localId ? { ...i, dbId } : i)),
                      );
                    })
                    .catch(logQueryCatch);
                }
              }
              // 视图不变量：流回调只在「用户仍在新对话页」时 adopt 新 session，
              // 用户已切走则绝不抢视图（effectiveSessionIdRef 运行时读，不用闭包 keepCurrentView）
              if (!opts.isResume) {
                const current = effectiveSessionIdRef.current;
                if (current === null || current === sid) {
                  flushSync(() => setSessionId(sid));
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("sessionId", sid);
                  if (params.get("agentId")) params.delete("agentId");
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }
              }
              // session 一建立就刷新侧边栏列表，不要等 onDone——用户发首条消息后
              // 新会话应立即可见，而非等第一条回复结束才出现。
              utils.session.list.invalidate().catch(logQueryCatch);
              scheduleStreamSave(true);
            },
            onRoundStart: (round) => {
              streamRound = round;
              // 不预插空 Thinking：无 reasoning 的工具轮不再留下空壳
            },
            onThinking: (delta) => {
              pendingThinkingDeltaRef.current.set(
                originSid,
                (pendingThinkingDeltaRef.current.get(originSid) ?? "") + delta,
              );
              pendingThinkingRoundRef.current.set(originSid, streamRound);
              scheduleThinkingFlush(originSid);
            },
            onToken: (delta) => {
              pendingStreamDeltaRef.current.set(
                originSid,
                (pendingStreamDeltaRef.current.get(originSid) ?? "") + delta,
              );
              scheduleStreamFlush(originSid);
            },
            onIntermediateContent: (content, round) => {
              discardStreamFlush(originSid);
              streamLifecycleActions.clearStreamingContent(originSid);
              const prev = pruneEmptyThinkingSteps(streamLifecycleStore.get(originSid).liveTimeline);
              if (prev.length !== streamLifecycleStore.get(originSid).liveTimeline.length) {
                streamLifecycleActions.replaceTimeline(originSid, prev);
              }
              if (!prev.some((step) => step.type === "content" && step.round === round)) {
                streamLifecycleActions.appendTimelineStep(originSid, {
                  type: "content" as const,
                  content,
                  round,
                });
              }
            },
            onToolPreparing: (tools, round) => {
              flushStreamNow(originSid);
              streamLifecycleActions.moveStreamingContentToTimeline(originSid, round);
              const pruned = pruneEmptyThinkingSteps(streamLifecycleStore.get(originSid).liveTimeline);
              let next = pruned;
              for (const t of tools) {
                if (!t.toolCallId || !t.name) continue;
                const idx = next.findIndex((s) => s.type === "tool" && s.toolCallId === t.toolCallId);
                if (idx >= 0) {
                  const prev = next[idx]!;
                  if (prev.type !== "tool") continue;
                  // 已进入 running/done 的不要打回 preparing
                  if (prev.status !== "preparing") continue;
                  next = next.map((s, i) =>
                    i === idx && s.type === "tool"
                      ? { ...s, name: t.name || s.name, argsChars: t.argsChars, round }
                      : s,
                  );
                } else {
                  next = [
                    ...next,
                    {
                      type: "tool" as const,
                      toolCallId: t.toolCallId,
                      name: t.name,
                      args: { _preparing: true, argsChars: t.argsChars },
                      round,
                      status: "preparing" as const,
                      argsChars: t.argsChars,
                      startedAt: Date.now(),
                    },
                  ];
                }
              }
              if (next !== pruned || next.length !== streamLifecycleStore.get(originSid).liveTimeline.length) {
                streamLifecycleActions.replaceTimeline(originSid, next);
              }
            },
            onToolStart: (name, args, round, toolCallId) => {
              flushStreamNow(originSid);
              // A7：反思拒稿已流出的草稿进时间线作中间结果，并清 streaming / 待合帧，
              // 避免气泡继续展示「像终稿」直到下一轮 token 覆盖。
              if (name === "__reflection__") {
                discardStreamFlush(originSid);
                streamLifecycleActions.moveStreamingContentToTimeline(originSid, round);
                streamLifecycleActions.clearStreamingContent(originSid);
              } else {
                streamLifecycleActions.moveStreamingContentToTimeline(originSid, round);
              }
              // 本轮若无思考正文，摘掉空 Thinking，避免工具条上方一排空壳
              const pruned = pruneEmptyThinkingSteps(streamLifecycleStore.get(originSid).liveTimeline);
              if (pruned.length !== streamLifecycleStore.get(originSid).liveTimeline.length) {
                streamLifecycleActions.replaceTimeline(originSid, pruned);
              }
              const existing = pruned.find((step) => step.type === "tool" && step.toolCallId === toolCallId);
              if (existing && existing.type === "tool") {
                streamLifecycleActions.updateTimelineStep(
                  originSid,
                  (step) => step.type === "tool" && step.toolCallId === toolCallId,
                  {
                    name,
                    args,
                    round,
                    status: "running",
                    startedAt: existing.startedAt ?? Date.now(),
                    argsChars: undefined,
                  },
                );
                return;
              }
              streamLifecycleActions.appendTimelineStep(originSid, {
                type: "tool",
                toolCallId,
                name,
                args,
                round,
                status: "running",
                startedAt: Date.now(),
              });
            },
            onToolEnd: (name, result, round, hint, toolCallId) => {
              streamLifecycleActions.updateTimelineStep(
                originSid,
                (step) =>
                  step.type === "tool" &&
                  step.toolCallId === toolCallId &&
                  (step.status === "running" || step.status === "preparing"),
                { result, hint: hint ?? formatToolResultHint(result), status: "done" },
              );
              if (
                (name === "async_task_run" || name === "spawn_subagent") &&
                result &&
                typeof result === "object"
              ) {
                const r = result as {
                  jobId?: string;
                  status?: string;
                  message?: string;
                  subagentSessionId?: string;
                  subagentName?: string;
                  agentId?: string;
                  success?: boolean;
                };
                if (name === "spawn_subagent" && (r.success || r.agentId || r.subagentSessionId)) {
                  if (r.agentId) {
                    const wsId = selectedWorkspaceId ?? null;
                    const parentId = effectiveAgentId ?? null;
                    const optimisticAgent = {
                      id: r.agentId,
                      name: r.subagentName || `子 Agent ${r.agentId.slice(0, 4)}`,
                      description: null,
                      model: getSessionConfig(originSid).model || DEFAULT_LLM_MODEL,
                      tools: [] as string[],
                      tier: "sub" as const,
                      workspaceId: wsId,
                      parentId,
                      heartbeatModel: null,
                      heartbeat: null,
                      status: "active",
                      source: "native_tool:spawn_subagent",
                      deletedAt: null,
                      deletedBy: null,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      systemPrompt: "",
                    };
                    const upsertAgentList = (
                      old:
                        | { items: typeof optimisticAgent[]; total: number; page: number; pageSize: number; totalPages: number }
                        | undefined,
                      pageSize: number,
                    ) => {
                      if (!old?.items) {
                        return { items: [optimisticAgent], total: 1, page: 1, pageSize, totalPages: 1 };
                      }
                      if (old.items.some((a) => a.id === r.agentId)) return old;
                      return {
                        ...old,
                        items: [optimisticAgent, ...old.items],
                        total: (old.total ?? old.items.length) + 1,
                      };
                    };
                    // 全量列表 + 左侧子 Agent tab（parentId + pageSize=50）两套 key 都要写
                    utils.agent.list.setData({ page: 1, pageSize: 100 }, (old) =>
                      upsertAgentList(old as never, 100),
                    );
                    if (parentId) {
                      utils.agent.list.setData(
                        { page: 1, pageSize: 50, parentId },
                        (old) => upsertAgentList(old as never, 50),
                      );
                    }
                  }
                  utils.agent.list.invalidate().then(() => utils.agent.list.refetch()).catch(logQueryCatch);
                  utils.session.list.invalidate().then(() => utils.session.list.refetch()).catch(logQueryCatch);
                  // 子会话树：与 SubagentPanel listChildren(pageSize=100) 对齐
                  utils.session.listChildren.invalidate().then(() => utils.session.listChildren.refetch()).catch(logQueryCatch);
                }
                if (r.jobId && (r.status === "running" || r.status === "queued")) {
                  const jobId = r.jobId;
                  const status = r.status;
                  sessionComposeActions.patchAsyncOverlays(originSid, (prev) => {
                    if (prev.some((q) => q.jobId === jobId)) return prev;
                    const label = r.message || r.subagentName || (name === "spawn_subagent" ? "子 Agent" : "后台任务");
                    return [
                      {
                        id: `run-${jobId}`,
                        kind: "async-running" as const,
                        text: r.message || "",
                        jobId,
                        taskLabel: label.slice(0, 60),
                        status: status === "queued" ? ("queued" as const) : ("running" as const),
                        subagentSessionId: r.subagentSessionId,
                        subagentName: r.subagentName,
                        createdAt: Date.now(),
                      },
                      ...prev,
                    ];
                  });
                } else if (name === "spawn_subagent" && r.subagentSessionId && !r.jobId) {
                  const overlayId = `spawn-${r.agentId ?? r.subagentSessionId}`;
                  sessionComposeActions.patchAsyncOverlays(originSid, (prev) => {
                    if (prev.some((q) => q.id === overlayId || q.subagentSessionId === r.subagentSessionId)) return prev;
                    const label = r.subagentName || r.message || "子 Agent 任务";
                    return [
                      {
                        id: overlayId,
                        kind: "async-running" as const,
                        text: r.message || "",
                        taskLabel: label.slice(0, 60),
                        status: "running" as const,
                        subagentSessionId: r.subagentSessionId,
                        subagentName: r.subagentName,
                        createdAt: Date.now(),
                      },
                      ...prev,
                    ];
                  });
                }
              }
              // 改变 agent/workspace 列表的工具：invalidate 左侧 panel 列表（spawn_subagent 已在上面处理）
              if (
                name === "agent_create" || name === "agent_create_sub" ||
                name === "agent_update" || name === "agent_update_sub" ||
                name === "agent_delete" || name === "agent_delete_sub" ||
                name === "workspace_create" || name === "workspace_archive"
              ) {
                utils.agent.list.invalidate().then(() => utils.agent.list.refetch()).catch(logQueryCatch);
                utils.session.list.invalidate().then(() => utils.session.list.refetch()).catch(logQueryCatch);
              }
              // 知识库写工具：立刻刷花园/文章列表，避免用户手动刷新
              if (
                name === "garden_create" || name === "garden_update" || name === "garden_delete" ||
                name === "post_create" || name === "post_update" || name === "post_delete"
              ) {
                utils.garden.list.invalidate().catch(logQueryCatch);
                utils.post.list.invalidate().catch(logQueryCatch);
                utils.post.tree.invalidate().catch(logQueryCatch);
                utils.post.categories.invalidate().catch(logQueryCatch);
                utils.post.tags.invalidate().catch(logQueryCatch);
                if (
                  (name === "post_create" || name === "post_update") &&
                  result &&
                  typeof result === "object"
                ) {
                  const r = result as { slug?: string; garden?: string; data?: { slug?: string; garden?: string } };
                  const slug = r.slug ?? r.data?.slug;
                  const garden = r.garden ?? r.data?.garden ?? "posts";
                  if (slug) {
                    utils.post.getBySlug.invalidate({ slug, garden }).catch(logQueryCatch);
                  }
                }
              }
              // Goal 工具：顶栏即时出现/消失；spawn 刷新会话列表
              if (
                name === "session_goal_set" ||
                name === "session_goal_clear" ||
                name === "session_goal_pause" ||
                name === "session_goal_resume"
              ) {
                if (originSid && originSid !== NEW_STREAM_KEY) {
                  utils.session.getGoal.invalidate({ sessionId: originSid }).catch(logQueryCatch);
                }
              }
              if (name === "session_spawn_goal") {
                utils.session.list.invalidate().then(() => utils.session.list.refetch()).catch(logQueryCatch);
                const r = result as { newSessionId?: string } | null;
                if (r?.newSessionId) {
                  utils.session.getGoal.invalidate({ sessionId: r.newSessionId }).catch(logQueryCatch);
                }
              }
            },
            onEventId: (id) => {
              streamLifecycleActions.setLastEventId(originSid, id);
            },
            onDone: (data) => {
              if (originSid === NEW_STREAM_KEY && data.sessionId) {
                flushStreamNow(originSid);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, data.sessionId);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, data.sessionId);
                migrateSessionConfig(NEW_STREAM_KEY, data.sessionId);
                originSid = data.sessionId;
              } else {
                flushStreamNow(originSid);
              }
              if (!opts.isResume) {
                // 视图不变量：onDone 不抢视图。adopt 已在 onSessionStart 完成；
                // 若用户已切走，结果写入该 session 的 MessageStore，用户切回时自然看到。
              }
              if (data.tokenUsage?.total) {
                streamLifecycleActions.setLastRoundTokens(originSid, data.tokenUsage.total);
              }
              if (opts.skillPrompt) {
                patchSessionConfig(
                  originSid,
                  { systemPrompt: opts.skillPrompt, customSystemPrompt: true },
                  true,
                );
              }
              if (data.sessionId) {
                utils.session.getById.invalidate({ id: data.sessionId }).catch(logQueryCatch);
              }
              const content = data.content ?? "";
              const assistantMessageId = data.assistantMessageId ?? null;
              // INV-1：先进入 done+pending，再幂等 upsert；MS upsert 会 tryCommit → idle → onStreamCommitted
              streamLifecycleActions.completeStream(originSid, content, { assistantMessageId });
              if (assistantMessageId) {
                sessionMessagesStore.upsertAssistantFromDone(originSid, {
                  assistantMessageId,
                  content,
                  toolCalls: data.toolCalls,
                  tokenUsage: data.tokenUsage ?? null,
                });
                // SSE 可能已先 upsert：再试一次 content/id 匹配
                streamLifecycleActions.tryCommitStream(originSid, {
                  messageId: assistantMessageId,
                  content,
                });
              } else {
                // 无 id（空回复等）：立即 commit，避免队列永久卡住
                streamLifecycleActions.commitStream(originSid);
              }
              if (opts.optimisticUser) {
                sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
              }
              utils.session.list.invalidate().catch(logQueryCatch);
            },
            onError: (message, sid, suggestion) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                migrateSessionConfig(NEW_STREAM_KEY, sid);
                originSid = sid;
              }
              if (opts.optimisticUser) {
                sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
              }
              // 迟到/重复 onError（幽灵已 ABORT、listRunning 已释放、重连耗尽叠打）：idle 幂等吞掉
              const phaseNow = streamLifecycleStore.get(originSid).phase;
              if (phaseNow === "idle") {
                return;
              }
              const msg = typeof message === "string" ? message : "";
              const isNoStream = msg.includes("没有运行中的 Agent 流");
              if (opts.isResume && isNoStream) {
                // resume 无流：ABORT 释放 streaming 占用（勿 COMMIT 直跳）
                discardStreamFlush(originSid);
                streamLifecycleActions.abortStream(originSid, {
                  partialAssistantMessageId: null,
                });
                hydrateSessionMessagesFallback(originSid).catch(logQueryCatch);
                return;
              }
              // 用户软暂停 / 中断：半截进 MessageStore 再拆 live，禁止 commit 后气泡变空
              const isUserAbort =
                msg === "user" ||
                msg.includes("用户中断") ||
                msg.includes("流式输出已被用户中断") ||
                msg.includes("已中止") ||
                msg.includes("已被主动取消") ||
                msg.includes("会话已停止");
              if (isUserAbort) {
                if (isPageUnloadingRef.current) return;
                // 用户软暂停/中断经 SSE error 到达：与 catch AbortError 同走 E3 abort-pending。
                // partial 由服务端按契约补发 message_upserted → tryCommit；禁止 hydrate 赌落库（P2-4）。
                flushStreamNow(originSid);
                const pendingPartial = streamLifecycleActions.takePendingAbortPartial(originSid);
                streamLifecycleActions.abortStream(originSid, {
                  partialAssistantMessageId: pendingPartial ?? null,
                  leftoverContent: streamLifecycleStore.get(originSid).streamingContent,
                });
                return;
              }
              // 服务端宕机 / 重连耗尽：用 ABORT 释放，勿 FAIL→COMMIT（idle 时会刷 console.error overlay）
              const isConnectivity =
                msg.includes("连接已断开") ||
                msg.includes("ECONNREFUSED") ||
                msg.includes("ECONNRESET") ||
                msg.includes("Failed to fetch") ||
                msg.includes("NetworkError") ||
                /HTTP 50[234]/.test(msg);
              if (opts.isResume || isConnectivity) {
                discardStreamFlush(originSid);
                streamLifecycleActions.abortStream(originSid, {
                  partialAssistantMessageId: null,
                  leftoverContent: streamLifecycleStore.get(originSid).streamingContent,
                });
                return;
              }
              discardStreamFlush(originSid);
              streamLifecycleActions.failStream(
                originSid,
                message + (suggestion ? `\n${suggestion}` : ""),
              );
              // error 仍占用队列语义上需释放 → commit 到 idle（保留 error 字段供 UI）
              streamLifecycleActions.commitStream(originSid);
              if (sid && !opts.isResume) {
                // 视图不变量：onError 不抢视图。错误存在该 session 的 lifecycle.error，
                // 用户若仍在新对话页则 adopt 让他看到错误；已切走则不抢。
                const current = effectiveSessionIdRef.current;
                if (current === null || current === sid) {
                  flushSync(() => setSessionId(sid));
                }
              }
            },
          },
          ac.signal,
        );
        return { status: "streamed" };
      } catch (err: unknown) {
        if (err instanceof SessionBusyQueuedError) {
          // beginStream 已占位：立刻释放，交给 drain 回滚认领
          discardStreamFlush(originSid);
          if (opts.optimisticUser) {
            sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
          }
          streamLifecycleActions.abortStream(originSid, {
            partialAssistantMessageId: null,
            leftoverContent: "",
          });
          return { status: "busy_queued", queueItemId: err.queueItemId };
        }
        if (err instanceof Error && err.name === "AbortError") {
          if (isPageUnloadingRef.current) {
            return { status: "streamed" };
          }
          flushStreamNow(originSid);
          const leftover = streamLifecycleStore.get(originSid).streamingContent;
          // E3：stopAgentChat 契约携带 partialAssistantMessageId；无 setTimeout 赌落库。
          // 有 id → ABORT 进 done（abort-pending），等 upsert 对齐 COMMIT；
          // null（明确无 partial）→ 立即 idle；非用户 stop（supersede）→ 立即 idle。
          const pendingPartial = streamLifecycleActions.takePendingAbortPartial(originSid);
          const partialId = pendingPartial === undefined ? null : pendingPartial;
          const phaseBefore = streamLifecycleStore.get(originSid).phase;
          if (phaseBefore === "streaming" || phaseBefore === "done") {
            streamLifecycleActions.abortStream(originSid, {
              partialAssistantMessageId: partialId,
              leftoverContent: leftover,
            });
          }
          // P2-4：有 partialId 靠 SSE message_upserted + tryCommit 对齐，禁止 hydrate 赌落库
          if (opts.optimisticUser) {
            sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
          }
          return { status: "streamed" };
        }
        discardStreamFlush(originSid);
        streamLifecycleActions.failStream(
          originSid,
          err instanceof Error ? err.message : "对话请求失败",
        );
        streamLifecycleActions.commitStream(originSid);
        return { status: "failed" };
      } finally {
        discardStreamFlush(originSid);
        streamLifecycleActions.setConnected(originSid, false);
        if (!isPageUnloadingRef.current) {
          const phase = streamLifecycleStore.get(originSid).phase;
          // 异常退出仍停在 streaming：ABORT_STREAM 合法释放（禁止 COMMIT 直跳 INV-1）
          if (phase === "streaming") {
            streamLifecycleActions.abortStream(originSid, {
              partialAssistantMessageId: null,
              leftoverContent: streamLifecycleStore.get(originSid).streamingContent,
            });
          }
        }
        streamLifecycleActions.releaseResumeClaim(originSid);
        sessionComposeActions.setActiveAbortController(originSid, null);
        sessionComposeActions.setQueueDraining(originSid, false);
        const finishedTaskId = sessionComposeStore.get(originSid).activeQueueTaskId;
        if (finishedTaskId) {
          sessionComposeActions.setActiveQueueTaskId(originSid, null);
          void finishedTaskId;
        }
        // 队列消费改由 onStreamCommitted（INV-1/2）驱动，finally 不再 hydrate+consume
      }
    },
    [
      effectiveAgentId,
      effectiveSessionId,
      selectedWorkspaceId,
      utils,
      selectedAgent,
      scheduleStreamFlush,
      scheduleThinkingFlush,
      flushStreamNow,
      discardStreamFlush,
      scheduleStreamSave,
      pathname,
      router,
      searchParams,
      createSessionQueueItemMutation,
      hydrateSessionMessagesFallback,
      effectiveSessionIdRef,
      isPageUnloadingRef,
      pendingStreamDeltaRef,
      pendingThinkingDeltaRef,
      setSessionId,
    ],
  );

  useEffect(() => {
    if (runStreamRef) {
      runStreamRef.current = runStream;
    }
  }, [runStream, runStreamRef]);

  return { runStream };
}
