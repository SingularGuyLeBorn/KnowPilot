/**
 * Chat 会话配置 — localStorage 持久化扩展参数
 */

import { CHAT_MODELS, type ChatSessionConfig } from "@knowpilot/shared";

const DEFAULT_KEY = "kp-chat-default-config";
const sessionKey = (id: string) => `kp-chat-session-${id}`;

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: "",
  enableReasoning: false,
  reasoningEffort: "high",
  customSystemPrompt: false,
};

export function getModelOption(modelId: string) {
  return CHAT_MODELS.find((m) => m.id === modelId) ?? CHAT_MODELS[0];
}

export function loadDefaultChatConfig(): ChatSessionConfig {
  try {
    const raw = localStorage.getItem(DEFAULT_KEY);
    if (raw) return { ...DEFAULT_CHAT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_CHAT_CONFIG };
}

export function saveDefaultChatConfig(config: ChatSessionConfig) {
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function loadSessionChatConfig(sessionId: string): ChatSessionConfig | null {
  try {
    const raw = localStorage.getItem(sessionKey(sessionId));
    if (raw) return { ...DEFAULT_CHAT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return null;
}

export function saveSessionChatConfig(sessionId: string, config: ChatSessionConfig) {
  try {
    localStorage.setItem(sessionKey(sessionId), JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function buildStreamConfig(config: ChatSessionConfig) {
  const modelOpt = getModelOption(config.model);
  const reasoningOn = modelOpt.reasoningRequired || config.enableReasoning;
  return {
    model: config.model,
    config: {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      enableReasoning: reasoningOn,
      reasoningEffort: config.reasoningEffort,
    },
  };
}
