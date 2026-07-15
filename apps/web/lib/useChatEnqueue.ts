"use client";

/**
 * useChatEnqueue —— 用户消息入队编排簇（W13e 从 chat.tsx 拆出）。
 *
 * enqueueMessage：/compact 斜杠指令改写、归档会话拦截、运行中 Steering/follow_up 注入、
 * 500ms 防重（lastEnqueueRef）、写 DB 拿 dbId 后入队 + INV-8 ① 显式 drain。
 * 纯结构拆分：useCallback 体与 deps 逐字未改，仅 sessionDetail?.status 解构重命名为
 * sessionStatus，并追加注入的稳定 ref（identity 恒定，行为等价）。本 hook 不新增任何
 * useEffect；drain 触发链唯一钩子仍在 chat.tsx【drain 订阅 · INV-8 ②④】。
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
  createSessionQueueItemMutation,
  submitInjectMutation,
  isSessionRunOccupied,
  showToast,
  consumeRef,
}: UseChatEnqueueParams) {
  // 防止极短时间重复入队（如发送按钮/快捷键连发）
  const lastEnqueueRef = useRef<{ text: string; at: number } | null>(null);

  const enqueueMessage = useCallback(
    (
      text: string,
      skill?: SelectedSkill,
      attachments?: ChatQueueItem["attachments"],
      delivery?: "steer" | "follow_up",
    ) => {
      let messageText = text.trim();
      if ((!messageText && !attachments?.length) || backendDown) return;

      // 斜杠指令：/compact → 作为普通用户消息交给 Agent，由 session_compact 工具执行
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

      // 运行中：默认 Steering；显式 follow_up 走停前续问（不改 phase，不 beginStream）
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
                ? "已加入纠偏，将在当前工具批结束后生效"
                : "已加入后续提问，将在本轮结束后继续",
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(msg || "注入失败");
          }
        })();
        return;
      }

      // 500ms 内相同文本（含空附件）视为重复发送，直接丢弃，避免重复气泡。
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

      // 有真实 sessionId 时：必须先写 DB 拿到 dbId 再入队。
      // 否则消费时无法删除 DB 项，刷新/水合会把同一条再送一遍。
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
            // INV-8 ①：用户入队 → 显式 drain
            consumeRef.current(effectiveSessionId);
          } catch (err) {
            console.warn("[enqueueMessage] 持久化失败，本会话仍入队（无 dbId）:", err);
            sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) => {
              if (prev.some((i) => i.id === localItem.id || i.text === localItem.text)) return prev;
              return [...prev, localItem];
            });
            // INV-8 ①：用户入队 → 显式 drain
            consumeRef.current(effectiveSessionId);
          }
        })();
        return;
      }

      sessionComposeActions.enqueueUserQueueItem(sid, localItem);
      // INV-8 ①：用户入队 → 显式 drain
      consumeRef.current(sid);
    },
    [backendDown, effectiveSessionId, createSessionQueueItemMutation, submitInjectMutation, sessionStatus, isSessionRunOccupied, showToast, consumeRef],
  );

  return { enqueueMessage };
}
