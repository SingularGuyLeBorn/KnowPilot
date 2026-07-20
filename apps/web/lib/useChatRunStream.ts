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

import { useCallback, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { streamAgentChat } from "@/lib/agentStream";
import { buildStreamConfig } from "@/lib/chatConfig";
import { formatToolResultHint } from "@/lib/chatMessageUtils";
import { type Agent, type ChatSessionConfig, DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import { type ChatQueueItem } from "@/lib/chatQueueTypes";
import { COMPOSE_STORAGE_KEY, LIFECYCLE_STORAGE_KEY, NEW_STREAM_KEY } from "@/lib/chatKeys";
import { sessionMessagesStore } from "@/lib/useSessionMessages";
import { streamLifecycleActions, streamLifecycleStore } from "@/lib/useStreamLifecycle";
import { sessionComposeActions, sessionComposeStore } from "@/lib/useSessionComposeState";

export function saveChatStoresToStorage() {
  try {
    const life = streamLifecycleStore.serialize();
    delete life[NEW_STREAM_KEY];
    sessionStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify(life));
    const compose = sessionComposeStore.serialize();
    delete compose[NEW_STREAM_KEY];
    sessionStorage.setItem(COMPOSE_STORAGE_KEY, JSON.stringify(compose));
  } catch {
    // ignore
  }
}

export type RunStreamOptions = {
  message?: string;
  attachments?: ChatQueueItem["attachments"];
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
  resumeAfter?: number;
  isResume?: boolean;
  targetSessionId?: string;
  /** 后台消费队列时：不抢占当前视图 / URL */
  keepCurrentView?: boolean;
  /** 覆盖 agentId（后台消费其它 session 时用该 session 的 Agent） */
  agentId?: string;
};

export interface UseChatRunStreamParams {
  effectiveSessionId: string | null;
  effectiveAgentId: string;
  chatConfig: ChatSessionConfig;
  selectedWorkspaceId: string | null;
  selectedAgent: Agent | undefined;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  createSessionQueueItemMutation: ReturnType<typeof trpc.agent.createSessionQueueItem.useMutation>;
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
  setEditingUserId: (id: string | null) => void;
  searchParams: ReturnType<typeof useSearchParams>;
  pathname: string;
  router: ReturnType<typeof useRouter>;
}

export function useChatRunStream({
  effectiveSessionId,
  effectiveAgentId,
  chatConfig,
  selectedWorkspaceId,
  selectedAgent,
  updateConfig,
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
  setEditingUserId,
  searchParams,
  pathname,
  router,
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

  const scheduleThinkingFlush = useCallback((sid: string) => {
    if (thinkingRafRef.current.has(sid)) return;
    const id = requestAnimationFrame(() => {
      thinkingRafRef.current.delete(sid);
      const delta = pendingThinkingDeltaRef.current.get(sid);
      if (delta) {
        pendingThinkingDeltaRef.current.delete(sid);
        streamLifecycleActions.appendThinkingDelta(sid, delta);
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
      streamLifecycleActions.appendThinkingDelta(sid, thinkDelta);
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
  }, [pendingStreamDeltaRef, streamRafRef, pendingThinkingDeltaRef, thinkingRafRef]);

  const runStream = useCallback(
    async (opts: RunStreamOptions) => {
      // 捕获本次流式所属的 session（新会话首条消息时为 NEW_STREAM_KEY，onDone 拿到 sessionId 后迁移）
      let originSid = opts.targetSessionId ?? effectiveSessionId ?? NEW_STREAM_KEY;
      // 视图不变量：流回调不依赖闭包 keepCurrentView，改用 effectiveSessionIdRef 运行时判断
      // keepCurrentView 参数仅保留给 consumeQueue 标记后台消费，不再在回调里使用
      void opts.keepCurrentView;
      sessionComposeActions.getActiveAbortController(originSid)?.abort();
      const ac = new AbortController();
      sessionComposeActions.setActiveAbortController(originSid, ac);

      const isResume = opts.isResume === true;
      streamLifecycleActions.beginStream(originSid, {
        streamTargetUserId:
          opts.retryFromMessageId ?? opts.regenerateUserMessageId ?? opts.editMessageId ?? null,
        resume: isResume,
      });
      // INV-2：非 resume 时若仍 occupied，beginStream 已 no-op，禁止继续发请求
      if (!isResume && streamLifecycleStore.get(originSid).phase !== "streaming") {
        sessionComposeActions.setActiveAbortController(originSid, null);
        sessionComposeActions.setQueueDraining(originSid, false);
        return;
      }
      scheduleStreamSave(true);
      setEditingUserId(null);

      const streamConfig = buildStreamConfig(
        {
          ...chatConfig,
          ...(opts.skillPrompt
            ? { systemPrompt: opts.skillPrompt, customSystemPrompt: true }
            : {}),
        },
        selectedAgent ? { systemPrompt: selectedAgent.systemPrompt } : undefined,
      );

      try {
        await streamAgentChat(
          {
            sessionId: opts.targetSessionId ?? effectiveSessionId ?? undefined,
            agentId: opts.agentId || effectiveAgentId || undefined,
            message: isResume ? undefined : opts.message,
            resumeAfter: opts.resumeAfter,
            attachments: opts.attachments?.map(({ name, mimeType, previewUrl, extractedText, source }) => ({
              name,
              mimeType,
              previewUrl: previewUrl ?? "",
              extractedText,
              source,
            })),
            regenerate: opts.regenerate,
            regenerateUserMessageId: opts.regenerateUserMessageId,
            retryFromMessageId: opts.retryFromMessageId,
            editMessageId: opts.editMessageId,
            editContent: opts.editContent,
            skillId: opts.skillId,
            source: opts.source,
            toolResults: opts.toolResults,
            clientMessageId: opts.optimisticUser?.id,
            ...streamConfig,
          },
          {
            onSessionStart: (sid) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                flushStreamNow(NEW_STREAM_KEY);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                originSid = sid;
                // 新会话首条消息期间入队的项尚无 dbId，迁移后补写 DB
                const pending = sessionComposeStore.get(sid).userQueue;
                for (const item of pending) {
                  if (item.dbId || (item.kind !== "user" && item.kind !== "superior")) continue;
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
                    .then((res) => {
                      const dbId = (res as { data?: { id?: string } })?.data?.id;
                      if (!dbId) return;
                      sessionComposeActions.patchUserQueue(sid, (q) =>
                        q.map((i) => (i.id === item.id ? { ...i, dbId } : i)),
                      );
                    })
                    .catch(() => {});
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
              void utils.session.list.invalidate();
              scheduleStreamSave(true);
            },
            onRoundStart: (round) => {
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (prev.length === 1 && prev[0]?.type === "thinking" && !prev[0].content) {
                streamLifecycleActions.replaceTimeline(originSid, [
                  { type: "thinking" as const, content: "", round },
                ]);
              } else {
                streamLifecycleActions.appendTimelineStep(originSid, {
                  type: "thinking" as const,
                  content: "",
                  round,
                });
              }
            },
            onThinking: (delta) => {
              pendingThinkingDeltaRef.current.set(
                originSid,
                (pendingThinkingDeltaRef.current.get(originSid) ?? "") + delta,
              );
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
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (!prev.some((step) => step.type === "content" && step.round === round)) {
                streamLifecycleActions.appendTimelineStep(originSid, {
                  type: "content" as const,
                  content,
                  round,
                });
              }
            },
            onToolStart: (name, args, round, toolCallId) => {
              flushStreamNow(originSid);
              streamLifecycleActions.moveStreamingContentToTimeline(originSid, round);
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (prev.some((step) => step.type === "tool" && step.toolCallId === toolCallId)) return;
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
                  step.type === "tool" && step.toolCallId === toolCallId && step.status === "running",
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
                    const optimisticAgent = {
                      id: r.agentId,
                      name: r.subagentName || `子 Agent ${r.agentId.slice(0, 4)}`,
                      description: null,
                      model: chatConfig.model || DEFAULT_LLM_MODEL,
                      tools: [] as string[],
                      tier: "sub" as const,
                      workspaceId: wsId,
                      parentId: effectiveAgentId ?? null,
                      heartbeatModel: null,
                      heartbeat: null,
                      status: "active",
                      source: "native_tool:spawn_subagent",
                      deletedAt: null,
                      deletedBy: null,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      apiKey: null,
                      systemPrompt: "",
                    };
                    utils.agent.list.setData({ page: 1, pageSize: 100 }, (old) => {
                      if (!old?.items) {
                        return { items: [optimisticAgent], total: 1, page: 1, pageSize: 100, totalPages: 1 };
                      }
                      if (old.items.some((a) => a.id === r.agentId)) return old;
                      return {
                        ...old,
                        items: [optimisticAgent, ...old.items],
                        total: (old.total ?? old.items.length) + 1,
                      };
                    });
                  }
                  void utils.agent.list.invalidate().then(() => utils.agent.list.refetch()).catch(() => undefined);
                  void utils.session.list.invalidate().then(() => utils.session.list.refetch()).catch(() => undefined);
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
            },
            onEventId: (id) => {
              streamLifecycleActions.setLastEventId(originSid, id);
            },
            onDone: (data) => {
              if (originSid === NEW_STREAM_KEY && data.sessionId) {
                flushStreamNow(originSid);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, data.sessionId);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, data.sessionId);
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
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              if (data.sessionId) {
                void utils.session.getById.invalidate({ id: data.sessionId }).catch(() => undefined);
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
              void utils.session.list.invalidate();
            },
            onError: (message, sid, suggestion) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                discardStreamFlush(originSid);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                originSid = sid;
              } else {
                discardStreamFlush(originSid);
              }
              if (opts.optimisticUser) {
                sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
              }
              const isNoStream =
                typeof message === "string" && message.includes("没有运行中的 Agent 流");
              if (opts.isResume && isNoStream) {
                // resume 无流：ABORT 释放 streaming 占用（勿 COMMIT 直跳）
                streamLifecycleActions.abortStream(originSid, {
                  partialAssistantMessageId: null,
                });
                void hydrateSessionMessagesFallback(originSid);
                return;
              }
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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          if (isPageUnloadingRef.current) {
            return;
          }
          flushStreamNow(originSid);
          const leftover = streamLifecycleStore.get(originSid).streamingContent;
          // INV-1：abort 时只 completeStream（phase=done，live 块继续显示 leftover），
          // 不立即 commit。服务端保存 partial assistant 后会广播 message_upserted
          // （或下方 hydrate 拉回）→ tryCommitAfterAssistant/Hydrate → tryCommitStream
          // 对齐后才 commit → idle。这样 live 块拆除与 stored 气泡出现原子切换，
          // 消除「中断后回复先消失再出现」的空窗。
          streamLifecycleActions.completeStream(originSid, leftover);
          const hydrateSid = originSid === NEW_STREAM_KEY ? (effectiveSessionId ?? "") : originSid;
          if (hydrateSid) void hydrateSessionMessagesFallback(hydrateSid);
          // 兜底：服务端可能无 partial 内容（abort 极早）→ 不会发 message_upserted，
          // done phase 会卡住队列。2s 后仍未 commit 则强制释放。
          window.setTimeout(() => {
            const st = streamLifecycleStore.get(originSid);
            if (st.phase === "done") {
              streamLifecycleActions.commitStream(originSid);
            }
          }, 2000);
          if (opts.optimisticUser) {
            sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
          }
          return;
        }
        discardStreamFlush(originSid);
        streamLifecycleActions.failStream(
          originSid,
          err instanceof Error ? err.message : "对话请求失败",
        );
        streamLifecycleActions.commitStream(originSid);
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
    [effectiveAgentId, chatConfig, effectiveSessionId, selectedWorkspaceId, updateConfig, utils.session.list, utils.session.getById, utils.agent.list, selectedAgent, scheduleStreamFlush, scheduleThinkingFlush, flushStreamNow, discardStreamFlush, scheduleStreamSave, pathname, router, searchParams, createSessionQueueItemMutation, hydrateSessionMessagesFallback, effectiveSessionIdRef, isPageUnloadingRef, pendingStreamDeltaRef, pendingThinkingDeltaRef, setEditingUserId, setSessionId],
  );

  return { runStream };
}
