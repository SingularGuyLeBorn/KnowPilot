"use client";

/**
 * useChatEnqueue —— 用户消息入队本仓（W13e 从 chat.tsx 抽出）。
 *
 * enqueueMessage：/goal|/research 斜杠指令、/compact 改写、归档拦截、运行中 Steering/follow_up 注入、
 * 500ms 防重（lastEnqueueRef）、写 DB 得 dbId 回填 + INV-8 ④ 显式 drain。
 */

import { useCallback, useRef, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import { type ChatQueueItem, createUserQueueItem } from "@/lib/chatQueueTypes";
import { type SelectedSkill } from "@/components/chatInput";
import { sessionComposeActions } from "@/lib/useSessionComposeState";
import { NEW_STREAM_KEY } from "@/lib/chatKeys";

export interface UseChatEnqueueParams {
  backendDown: boolean;
  effectiveSessionId: string | null;
  sessionStatus: string | undefined;
  /** 子 Agent 会话禁用 Goal / 深度调研 */
  isSubagentSession: boolean;
  /** 是否允许启动深度调研（仅空会话 / 新会话） */
  canStartDeepResearch: boolean;
  createSessionQueueItemMutation: ReturnType<typeof trpc.agent.createSessionQueueItem.useMutation>;
  submitInjectMutation: ReturnType<typeof trpc.agent.submitInject.useMutation>;
  isSessionRunOccupied: (sid: string | null) => boolean;
  showToast: (msg: string | null) => void;
  consumeRef: RefObject<(preferredSessionId?: string) => void>;
}

export function useChatEnqueue({
  backendDown,
  effectiveSessionId,
  sessionStatus,
  isSubagentSession,
  canStartDeepResearch,
  createSessionQueueItemMutation,
  submitInjectMutation,
  isSessionRunOccupied,
  showToast,
  consumeRef,
}: UseChatEnqueueParams) {
  const lastEnqueueRef = useRef<{ text: string; at: number } | null>(null);
  const setGoalMutation = trpc.session.setGoal.useMutation();
  const pauseGoalMutation = trpc.session.pauseGoal.useMutation();
  const resumeGoalMutation = trpc.session.resumeGoal.useMutation();
  const clearGoalMutation = trpc.session.clearGoal.useMutation();
  const utils = trpc.useUtils();

  const enqueueMessage = useCallback(
    (
      text: string,
      skill?: SelectedSkill,
      attachments?: ChatQueueItem["attachments"],
      delivery?: "steer" | "follow_up",
    ) => {
      let messageText = text.trim();
      if ((!messageText && !attachments?.length) || backendDown) return;

      // 斜杠指令：/goal|/research|/deepresearch …
      if (!attachments?.length) {
        const goalMatch = messageText.match(/^\/(goal|research|deepresearch|deep-research)(?:\s+(.*))?$/i);
        if (goalMatch) {
          const cmd = goalMatch[1]!.toLowerCase();
          const rest = (goalMatch[2] ?? "").trim();
          const isResearch = cmd === "research" || cmd === "deepresearch" || cmd === "deep-research";

          if (isSubagentSession) {
            showToast("子 Agent 会话不支持 Goal / 深度调研");
            return;
          }
          if (!effectiveSessionId) {
            showToast(
              isResearch
                ? "请先打开主会话（或先发一条消息创建会话）再启动深度调研"
                : "请先打开会话，然后输入 /goal 你的目标",
            );
            return;
          }
          if (isResearch && !canStartDeepResearch) {
            showToast("深度调研只能在新会话发送第一条消息之前选择");
            return;
          }

          void (async () => {
            try {
              if (!rest || /^status$/i.test(rest)) {
                if (isResearch && !rest) {
                  showToast("用法：/research 调研主题（仅新会话首条前）");
                  return;
                }
                if (!rest) {
                  showToast("用法：/goal 目标内容 · 也可用 /goal pause|resume|clear|status");
                  return;
                }
                const g = await utils.session.getGoal.fetch({ sessionId: effectiveSessionId });
                const goal = g.goal;
                showToast(
                  goal
                    ? `${goal.mode === "deep_research" ? "调研" : "Goal"} ${goal.status} ${goal.turnsUsed}/${goal.maxTurns}：${goal.text.slice(0, 80)}`
                    : "当前会话没有活跃目标",
                );
                return;
              }
              if (/^pause$/i.test(rest)) {
                await pauseGoalMutation.mutateAsync({ sessionId: effectiveSessionId });
                showToast("目标已暂停");
                return;
              }
              if (/^resume$/i.test(rest)) {
                await resumeGoalMutation.mutateAsync({ sessionId: effectiveSessionId });
                showToast("目标已恢复");
                return;
              }
              if (/^clear$/i.test(rest)) {
                await clearGoalMutation.mutateAsync({ sessionId: effectiveSessionId });
                showToast("目标已清除");
                return;
              }
              await setGoalMutation.mutateAsync({
                sessionId: effectiveSessionId,
                text: rest,
                mode: isResearch ? "deep_research" : "goal",
                startNow: true,
              });
              showToast(isResearch ? "深度调研已启动" : "目标已设定并开始");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Goal 操作失败");
            }
          })();
          return;
        }
      }

      if (/^\/compact\s*$/i.test(messageText) && !attachments?.length) {
        if (!effectiveSessionId) {
          showToast("请先选择或创建一个会话");
          return;
        }
        if (sessionStatus === "archived") {
          showToast("此会话已归档，无法压缩");
          return;
        }
        messageText = "请压缩当前会话上下文";
      }

      if (sessionStatus === "archived") {
        showToast("此会话已归档，请跳转到新会话继续对话");
        return;
      }

      if (effectiveSessionId && isSessionRunOccupied(effectiveSessionId)) {
        const kind = delivery === "follow_up" ? "follow_up" : "steer";
        if (!messageText) return;
        void (async () => {
          try {
            await submitInjectMutation.mutateAsync({
              sessionId: effectiveSessionId,
              content: messageText,
              kind,
            });
            showToast(
              kind === "steer"
                ? "已注入偏转，将在当前轮尽快生效"
                : "已加入后续追问，将在本轮结束后处理",
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(msg || "注入失败");
          }
        })();
        return;
      }

      const now = Date.now();
      const last = lastEnqueueRef.current;
      const attachmentsKey = attachments?.map((a) => a.name).join("\n") ?? "";
      if (last && now - last.at < 500 && last.text === `${messageText}\n${attachmentsKey}`) {
        return;
      }
      lastEnqueueRef.current = { text: `${messageText}\n${attachmentsKey}`, at: now };
      const skillPrompt = skill
        ? `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`
        : undefined;
      const sid = effectiveSessionId ?? NEW_STREAM_KEY;
      const localItem = createUserQueueItem(messageText || "（见附件）", {
        skillId: skill?.id,
        skillPrompt,
        attachments,
      });

      if (effectiveSessionId) {
        void (async () => {
          try {
            const res = await createSessionQueueItemMutation.mutateAsync({
              sessionId: effectiveSessionId,
              kind: "user",
              content: localItem.text,
              source: "user",
              attachments: localItem.attachments,
              skillId: localItem.skillId,
              skillPrompt: localItem.skillPrompt,
            });
            const dbId = (res as { data?: { id?: string } })?.data?.id;
            if (!dbId) {
              console.warn("[enqueueMessage] createSessionQueueItem 未返回 id，跳过入队以防重复发送");
              return;
            }
            sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) => {
              if (prev.some((i) => i.dbId === dbId || i.id === localItem.id)) return prev;
              if (prev.some((i) => !i.dbId && i.text === localItem.text && i.kind === "user")) {
                return prev.map((i) =>
                  !i.dbId && i.text === localItem.text && i.kind === "user"
                    ? { ...i, dbId }
                    : i,
                );
              }
              return [...prev, { ...localItem, dbId }];
            });
            consumeRef.current(effectiveSessionId);
          } catch (err) {
            console.warn("[enqueueMessage] 持久化失败，仅本地入队（无 dbId）:", err);
            sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) => {
              if (prev.some((i) => i.id === localItem.id || i.text === localItem.text)) return prev;
              return [...prev, localItem];
            });
            consumeRef.current(effectiveSessionId);
          }
        })();
        return;
      }

      sessionComposeActions.enqueueUserQueueItem(sid, localItem);
      consumeRef.current(sid);
    },
    [
      backendDown,
      effectiveSessionId,
      isSubagentSession,
      canStartDeepResearch,
      createSessionQueueItemMutation,
      submitInjectMutation,
      isSessionRunOccupied,
      showToast,
      consumeRef,
      sessionStatus,
      setGoalMutation,
      pauseGoalMutation,
      resumeGoalMutation,
      clearGoalMutation,
      utils.session.getGoal,
    ],
  );

  return { enqueueMessage };
}
