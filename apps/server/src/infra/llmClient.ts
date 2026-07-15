/**
 * OpenAI 协议 LLM 客户端 — 支持多厂商与 Function Calling
 */

import type { AppConfig, LlmProviderConfig } from "./config.js";
import type { ReasoningEffort } from "@knowpilot/shared";
import { LLM_MODEL_IDS, LLM_PROVIDER_DEEPSEEK } from "@knowpilot/shared";
import { mockChatCompletion, mockChatCompletionStream } from "./mockLlmClient.js";

/** LLM HTTP 错误：携带状态码与响应体，供弹性层（resilientLlmClient）分类 */
export class LlmHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "LlmHttpError";
  }
}

export interface LlmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LlmContentPart[] | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LlmToolCall[];
  /** DeepSeek V4 思考链 — 工具调用回合必须原样回传 */
  reasoning_content?: string | null;
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmCompletionResult {
  content: string | null;
  reasoningContent?: string | null;
  toolCalls: LlmToolCall[];
  tokenUsage?: { prompt: number; completion: number; total: number };
  finishReason: string | null;
  model: string;
  provider: string;
}

/** LLM 请求扩展（DeepSeek V4 思考模式） */
export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface ResolvedDeepSeekRequest {
  apiModel: string;
  thinking: "enabled" | "disabled";
  reasoningEffort: "high" | "max";
  isDeepSeek: boolean;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  // 值为各厂商 API 域名（属配置数据，非模型名硬编码）
  [LLM_PROVIDER_DEEPSEEK]: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  baichuan: "https://api.baichuan-ai.com/v1",
  "01ai": "https://api.lingyiwanwu.com/v1",
  xai: "https://api.x.ai/v1",
  cohere: "https://api.cohere.com/compatibility/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export function resolveProvider(config: AppConfig, modelOrProvider?: string): LlmProviderConfig & { id: string } {
  const raw = (modelOrProvider || config.llm.defaultProvider).trim();
  const providerId = config.llm.providers[raw] ? raw : config.llm.defaultProvider;
  const provider = config.llm.providers[providerId];
  if (!provider?.apiKey) {
    throw new Error(
      `LLM 厂商 "${providerId}" 未配置 API Key。请在项目根目录 .env 中设置对应密钥（如 VITE_DEEPSEEK_API_KEY 或 DEEPSEEK_API_KEY）。`,
    );
  }
  return { id: providerId, ...provider };
}

/**
 * 解析 Agent/Session 实际使用的 model id。
 * `.env` 的 DEEPSEEK_MODEL / VITE_DEEPSEEK_MODEL 在仍为旧 chat id 时覆盖。
 */
export function resolveEffectiveAgentModel(config: AppConfig, model: string): string {
  const trimmed = model.trim();
  const envDeepseek = config.llm.providers[LLM_PROVIDER_DEEPSEEK]?.model?.trim();
  if ((trimmed === LLM_MODEL_IDS.DEEPSEEK_CHAT || !trimmed) && envDeepseek) {
    return envDeepseek;
  }
  return trimmed || envDeepseek || config.llm.defaultModel;
}

/** API 文档：low/medium → high，xhigh → max；此处仅暴露 high/max */
export function normalizeReasoningEffort(effort?: ReasoningEffort): "high" | "max" {
  return effort === "max" ? "max" : "high";
}

export function isDeepSeekFamily(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes(LLM_PROVIDER_DEEPSEEK);
}

/**
 * 对齐 DeepSeek V4 Thinking Mode 文档：
 * - thinking.type: enabled | disabled（V4 默认 enabled）
 * - reasoning_effort: high | max
 * - 旧 chat / reasoner id 映射到 V4 Flash
 */
export function resolveDeepSeekRequest(
  config: AppConfig,
  requestedModel: string,
  options: Pick<LlmRequestOptions, "enableReasoning" | "reasoningEffort">,
): ResolvedDeepSeekRequest {
  let model = resolveEffectiveAgentModel(config, requestedModel);
  const effort = normalizeReasoningEffort(options.reasoningEffort);

  if (model === LLM_MODEL_IDS.DEEPSEEK_REASONER) {
    return { apiModel: LLM_MODEL_IDS.DEEPSEEK_V4_FLASH, thinking: "enabled", reasoningEffort: effort, isDeepSeek: true };
  }

  if (model === LLM_MODEL_IDS.DEEPSEEK_CHAT) {
    model = LLM_MODEL_IDS.DEEPSEEK_V4_FLASH;
  }

  if (model.toLowerCase().includes("vl")) {
    return { apiModel: model, thinking: "disabled", reasoningEffort: effort, isDeepSeek: true };
  }

  if (!isDeepSeekFamily(model)) {
    return { apiModel: model, thinking: "disabled", reasoningEffort: effort, isDeepSeek: false };
  }

  const thinking: "enabled" | "disabled" =
    options.enableReasoning === false ? "disabled" : "enabled";

  return { apiModel: model, thinking, reasoningEffort: effort, isDeepSeek: true };
}

export function serializeMessagesForApi(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const row: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.tool_calls?.length) row.tool_calls = m.tool_calls;
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
    if (m.name) row.name = m.name;
    if (m.tool_calls?.length) {
      row.reasoning_content = m.reasoning_content ?? "";
    } else if (m.reasoning_content) {
      row.reasoning_content = m.reasoning_content;
    }
    return row;
  });
}

function applyDeepSeekThinkingBody(
  body: Record<string, unknown>,
  resolved: ResolvedDeepSeekRequest,
): void {
  if (!resolved.isDeepSeek) return;
  body.thinking = { type: resolved.thinking };
  if (resolved.thinking === "enabled") {
    body.reasoning_effort = resolved.reasoningEffort;
  }
}

/** 根据 model 字段推断 provider（agent.model 可能是 v4-flash / kimi-k2.5 等各厂商模型 id） */
export function inferProviderFromModel(config: AppConfig, model: string): LlmProviderConfig & { id: string } {
  const lower = model.toLowerCase();
  if (lower.includes(LLM_PROVIDER_DEEPSEEK)) return resolveProvider(config, LLM_PROVIDER_DEEPSEEK);
  if (lower.includes("kimi") || lower.includes("moonshot")) return resolveProvider(config, "kimi");
  if (lower.includes("glm")) return resolveProvider(config, "zhipu");
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) {
    return resolveProvider(config, "openai");
  }
  if (lower.includes("gemini")) return resolveProvider(config, "gemini");
  if (lower.includes("claude")) return resolveProvider(config, "anthropic");
  if (lower.includes("qwen")) return resolveProvider(config, "qwen");
  if (lower.includes("grok")) return resolveProvider(config, "xai");
  if (lower.includes("mistral") || lower.includes("mixtral")) return resolveProvider(config, "mistral");
  return resolveProvider(config, config.llm.defaultProvider);
}

function resolveEffectiveModel(requested: string | undefined, providerDefault: string): string {
  if (!requested?.trim()) return providerDefault;
  const r = requested.trim();
  const lower = r.toLowerCase();
  if (lower === "kimi" || lower === "moonshot-v1-auto" || lower.includes("moonshot")) {
    return providerDefault;
  }
  return r.includes("/") ? providerDefault : r;
}

export async function chatCompletion(options: {
  config: AppConfig;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
} & LlmRequestOptions): Promise<LlmCompletionResult> {
  if (process.env.MOCK_LLM === "true") {
    return mockChatCompletion(options);
  }
  const provider = options.model
    ? inferProviderFromModel(options.config, options.model)
    : resolveProvider(options.config);

  const ds = resolveDeepSeekRequest(options.config, options.model || provider.model, options);
  const model = resolveEffectiveModel(ds.apiModel, provider.model);
  const baseUrl = (provider.baseUrl || DEFAULT_BASE_URLS[provider.id] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model,
    messages: serializeMessagesForApi(options.messages),
    max_tokens: options.maxTokens ?? 4096,
  };
  if (!ds.isDeepSeek || ds.thinking === "disabled") {
    body.temperature = options.temperature ?? 0.7;
  }
  applyDeepSeekThinkingBody(body, { ...ds, apiModel: model });
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new LlmHttpError(
      `LLM 请求失败 (${provider.id}, HTTP ${res.status}): ${text.slice(0, 500)}`,
      res.status,
      text.slice(0, 500),
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: LlmToolCall[];
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };

  const choice = data.choices?.[0];
  const usage = data.usage;
  const reasoningContent = choice?.message?.reasoning_content ?? null;
  const rawContent = choice?.message?.content ?? null;
  // 思考与正文分离：不要把 reasoning_content 填进 content，否则会与正式回复串台，
  // 并误导上层再走一遍「有思考 → 二次 stream」路径。
  const content = rawContent?.trim() ? rawContent : null;

  return {
    content,
    reasoningContent,
    toolCalls: choice?.message?.tool_calls ?? [],
    tokenUsage: usage
      ? {
          prompt: usage.prompt_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
          total: usage.total_tokens ?? 0,
        }
      : undefined,
    finishReason: choice?.finish_reason ?? null,
    model: data.model || model,
    provider: provider.id,
  };
}

export interface StreamChunk {
  type: "token" | "reasoning" | "tool_calls";
  delta?: string;
  toolCalls?: LlmToolCall[];
  finishReason?: string | null;
  model?: string;
  provider?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

/** OpenAI 协议 SSE 流式补全（仅文本 delta；tool_calls 在流结束后一次性返回） */
export async function* chatCompletionStream(options: {
  config: AppConfig;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
} & LlmRequestOptions): AsyncGenerator<StreamChunk> {
  if (process.env.MOCK_LLM === "true") {
    yield* mockChatCompletionStream(options);
    return;
  }
  const provider = options.model
    ? inferProviderFromModel(options.config, options.model)
    : resolveProvider(options.config);

  const ds = resolveDeepSeekRequest(options.config, options.model || provider.model, options);
  const model = resolveEffectiveModel(ds.apiModel, provider.model);
  const baseUrl = (provider.baseUrl || DEFAULT_BASE_URLS[provider.id] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model,
    messages: serializeMessagesForApi(options.messages),
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
  };
  if (!ds.isDeepSeek || ds.thinking === "disabled") {
    body.temperature = options.temperature ?? 0.7;
  }
  applyDeepSeekThinkingBody(body, { ...ds, apiModel: model });
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new LlmHttpError(
      `LLM 流式请求失败 (${provider.id}, HTTP ${res.status}): ${text.slice(0, 500)}`,
      res.status,
      text.slice(0, 500),
    );
  }

  if (!res.body) throw new Error("LLM 流式响应无 body");

  const reader = res.body.getReader();
  try {
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallsAcc = new Map<number, LlmToolCall>();
  let finishReason: string | null = null;
  let usage: { prompt: number; completion: number; total: number } | undefined;
  let responseModel = model;
  while (true) {
    if (options.signal?.aborted) {
      const err = new Error("流式输出已被用户中断");
      err.name = "AbortError";
      throw err;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      let parsed: {
        model?: string;
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      if (parsed.model) responseModel = parsed.model;
      const choice = parsed.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finishReason = choice.finish_reason;

      if (choice.delta?.reasoning_content) {
        yield {
          type: "reasoning",
          delta: choice.delta.reasoning_content,
          model: responseModel,
          provider: provider.id,
        };
      }

      if (choice.delta?.content) {
        yield { type: "token", delta: choice.delta.content, model: responseModel, provider: provider.id };
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = toolCallsAcc.get(tc.index) ?? {
            id: tc.id || `call_${tc.index}`,
            type: "function" as const,
            function: { name: "", arguments: "" },
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          toolCallsAcc.set(tc.index, existing);
        }
      }

      if (parsed.usage) {
        usage = {
          prompt: parsed.usage.prompt_tokens ?? 0,
          completion: parsed.usage.completion_tokens ?? 0,
          total: parsed.usage.total_tokens ?? 0,
        };
      }
    }
  }

  const toolCalls = [...toolCallsAcc.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
  if (toolCalls.length > 0) {
    yield {
      type: "tool_calls",
      toolCalls,
      finishReason,
      model: responseModel,
      provider: provider.id,
      tokenUsage: usage,
    };
  } else {
    // 思考已通过 type:"reasoning" 逐片输出；此处不要把 reasoningAcc 再当正式 token，
    // 否则思考会灌进正式回复气泡，造成「思考/正文串台」。
    yield {
      type: "token",
      delta: "",
      finishReason,
      model: responseModel,
      provider: provider.id,
      tokenUsage: usage,
    };
  }
  } finally {
    // 消费者提前 break / throw 时释放 reader 锁并取消底层流，
    // 避免 HTTP 连接泄漏（fetch body stream 不自动关闭）。
    reader.releaseLock();
    try { await res.body?.cancel(); } catch { /* already closed */ }
  }
}
