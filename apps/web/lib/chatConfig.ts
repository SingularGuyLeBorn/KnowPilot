/**
 * Chat 会话配置 — localStorage 持久化扩展参数
 */

import { CHAT_MODELS, DEFAULT_LLM_MODEL, LLM_PROVIDER_DEEPSEEK, type ChatSessionConfig } from "@knowpilot/shared";

const DEFAULT_KEY = "kp-chat-default-config";
const sessionKey = (id: string) => `kp-chat-session-${id}`;

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
  model: DEFAULT_LLM_MODEL,
  temperature: 0.7,
  maxTokens: 8192,
  systemPrompt: "",
  enableReasoning: true,
  reasoningEffort: "high",
  customSystemPrompt: false,
  // 0 表示走后端全局默认（AGENT_TOOL_CALL_TIMEOUT_MS / AGENT_MAX_TOOL_ROUNDS）
  toolCallTimeoutMs: 0,
  maxToolRounds: 0,
};

export function getModelOption(modelId: string) {
  const found = CHAT_MODELS.find((m) => m.id === modelId);
  if (found) return found;
  const isDeepSeek = modelId.includes(LLM_PROVIDER_DEEPSEEK);
  const isVision = modelId.includes("vl") || modelId.includes("vision");
  return {
    id: modelId,
    label: modelId,
    provider: isDeepSeek ? LLM_PROVIDER_DEEPSEEK : "openai",
    supportsThinking: isDeepSeek && !isVision,
    supportsReasoning: isDeepSeek && !isVision,
    supportsVision: isVision,
    ocrFallback: isDeepSeek && !isVision,
    inputHint: isVision
      ? "多模态识图 · 支持直接发送图片"
      : "纯文本模型 · 图片将 OCR 识别后以文字附在消息中",
    defaultTemperature: 0.7,
  };
}

export function loadDefaultChatConfig(): ChatSessionConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CHAT_CONFIG };
  try {
    const raw = localStorage.getItem(DEFAULT_KEY);
    if (raw) return { ...DEFAULT_CHAT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_CHAT_CONFIG };
}

/** 新对话：未自定义 Prompt 时跟随 Agent 默认 systemPrompt */
export function resolveNewChatConfig(
  base: ChatSessionConfig,
  agent?: { model: string; systemPrompt: string } | null,
): ChatSessionConfig {
  if (!agent || base.customSystemPrompt) return base;
  return {
    ...base,
    // 新对话默认跟随 Agent 的模型，避免 localStorage 中旧模型长期覆盖
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    customSystemPrompt: false,
  };
}

export function saveDefaultChatConfig(config: ChatSessionConfig) {
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function loadSessionChatConfig(sessionId: string): ChatSessionConfig | null {
  if (typeof window === "undefined") return null;
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

export function buildStreamConfig(
  config: ChatSessionConfig,
  agentFallback?: { systemPrompt: string },
) {
  const modelOpt = getModelOption(config.model);
  const reasoningOn = modelOpt.reasoningRequired ? true : config.enableReasoning;
  const systemPrompt =
    config.systemPrompt.trim() ||
    (config.customSystemPrompt ? "" : agentFallback?.systemPrompt ?? "");
  return {
    model: config.model,
    config: {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt,
      enableReasoning: reasoningOn,
      reasoningEffort: config.reasoningEffort,
      // 0/缺省不传，后端走全局默认；非 0 才覆盖
      ...(config.toolCallTimeoutMs ? { toolCallTimeoutMs: config.toolCallTimeoutMs } : {}),
      ...(config.maxToolRounds ? { maxToolRounds: config.maxToolRounds } : {}),
    },
  };
}
