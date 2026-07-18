"use client";

/**
 * useChatConfig —— 会话模型 / systemPrompt 配置的加载、派生与持久化。
 *
 * 【会话配置域】原 chat.tsx 配置加载 effect + updateConfig / resetPromptToAgent 收拢。
 * effect 体未改：localStorage 会话配置优先，其次 session 落库值，最后 Agent 默认；
 * 新会话页走 resolveNewChatConfig(默认配置, selectedAgent)。
 */

import { useCallback, useEffect, useState, startTransition } from "react";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_CHAT_CONFIG,
  loadDefaultChatConfig,
  loadSessionChatConfig,
  resolveNewChatConfig,
  saveDefaultChatConfig,
  saveSessionChatConfig,
} from "@/lib/chatConfig";
import { type Agent, type ChatSessionConfig } from "@knowpilot/shared";

export function useChatConfig(opts: {
  effectiveSessionId: string | null;
  selectedAgent: Agent | undefined;
  sessionDetailModel: string | null | undefined;
  sessionDetailSystemPrompt: string | null | undefined;
}) {
  const { effectiveSessionId, selectedAgent, sessionDetailModel, sessionDetailSystemPrompt } = opts;
  const [chatConfig, setChatConfig] = useState<ChatSessionConfig>(DEFAULT_CHAT_CONFIG);
  const updateSession = trpc.session.update.useMutation();
  // W16b：.mutate 是 observer 绑定的稳定引用（整个 mutation 对象每渲染新建），
  // 进 useCallback deps 用稳定引用，否则 updateConfig 每渲染换引用、R17 memo 承诺失效
  const updateSessionMutate = updateSession.mutate;

  // 【会话配置域】会话模型/systemPrompt 配置加载与派生（effect 体自 chat.tsx 原样迁入）
  useEffect(() => {
    if (effectiveSessionId) {
      if (!selectedAgent) return;
      const saved = loadSessionChatConfig(effectiveSessionId);
      startTransition(() => {
        if (saved) {
          // 已有会话保留用户选择的模型，只同步 systemPrompt（如果用户没自定义）
          setChatConfig({
            ...saved,
            systemPrompt: saved.customSystemPrompt
              ? saved.systemPrompt
              : (saved.systemPrompt || selectedAgent.systemPrompt),
          });
          return;
        }
        setChatConfig((prev) => ({
          ...prev,
          model: sessionDetailModel ?? selectedAgent.model,
          systemPrompt:
            sessionDetailSystemPrompt?.trim() || selectedAgent.systemPrompt,
          customSystemPrompt:
            !!sessionDetailSystemPrompt?.trim() &&
            sessionDetailSystemPrompt !== selectedAgent.systemPrompt,
        }));
      });
    } else {
      startTransition(() => {
        setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
      });
    }
  }, [effectiveSessionId, selectedAgent, sessionDetailModel, sessionDetailSystemPrompt]);

  const updateConfig = useCallback(
    (patch: Partial<ChatSessionConfig>) => {
      setChatConfig((prev) => {
        const next = { ...prev, ...patch };
        if (effectiveSessionId) saveSessionChatConfig(effectiveSessionId, next);
        else saveDefaultChatConfig(next);
        if (effectiveSessionId && (patch.model || patch.systemPrompt !== undefined)) {
          updateSessionMutate({
            id: effectiveSessionId,
            ...(patch.model ? { model: patch.model } : {}),
            ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
          });
        }
        return next;
      });
    },
    [effectiveSessionId, updateSessionMutate],
  );

  // R17：useCallback 稳定化，供输入区模型菜单等 memo 子树复用
  const resetPromptToAgent = useCallback(() => {
    if (!selectedAgent) return;
    updateConfig({ systemPrompt: selectedAgent.systemPrompt, customSystemPrompt: false });
  }, [selectedAgent, updateConfig]);

  return { chatConfig, setChatConfig, updateConfig, resetPromptToAgent };
}
