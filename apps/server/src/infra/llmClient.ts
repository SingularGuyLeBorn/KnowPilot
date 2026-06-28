/**
 * OpenAI 兼容 LLM 客户端 — 支持多厂商与 Function Calling
 */

import type { AppConfig, LlmProviderConfig } from "./config.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LlmToolCall[];
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

const DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
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

/** 根据 model 字段推断 provider（agent.model 可能是 deepseek-chat / kimi-k2.5 等） */
export function inferProviderFromModel(config: AppConfig, model: string): LlmProviderConfig & { id: string } {
  const lower = model.toLowerCase();
  if (lower.includes("deepseek")) return resolveProvider(config, "deepseek");
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

function resolveEffectiveModel(
  requested: string | undefined,
  providerDefault: string,
  enableReasoning?: boolean,
): string {
  const base = requested && !requested.includes("/") ? requested : providerDefault;
  if (enableReasoning && base.includes("deepseek") && !base.includes("reasoner")) {
    return "deepseek-reasoner";
  }
  return base;
}

export async function chatCompletion(options: {
  config: AppConfig;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
}): Promise<LlmCompletionResult> {
  const provider = options.model
    ? inferProviderFromModel(options.config, options.model)
    : resolveProvider(options.config);

  const model = resolveEffectiveModel(options.model, provider.model, options.enableReasoning);
  const baseUrl = (provider.baseUrl || DEFAULT_BASE_URLS[provider.id] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  };
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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 请求失败 (${provider.id}, HTTP ${res.status}): ${text.slice(0, 500)}`);
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

  return {
    content: choice?.message?.content ?? null,
    reasoningContent: choice?.message?.reasoning_content ?? null,
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

/** OpenAI 兼容 SSE 流式补全（仅文本 delta；tool_calls 在流结束后一次性返回） */
export async function* chatCompletionStream(options: {
  config: AppConfig;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
}): AsyncGenerator<StreamChunk> {
  const provider = options.model
    ? inferProviderFromModel(options.config, options.model)
    : resolveProvider(options.config);

  const model = resolveEffectiveModel(options.model, provider.model, options.enableReasoning);
  const baseUrl = (provider.baseUrl || DEFAULT_BASE_URLS[provider.id] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
  };
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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 流式请求失败 (${provider.id}, HTTP ${res.status}): ${text.slice(0, 500)}`);
  }

  if (!res.body) throw new Error("LLM 流式响应无 body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallsAcc = new Map<number, LlmToolCall>();
  let finishReason: string | null = null;
  let usage: { prompt: number; completion: number; total: number } | undefined;
  let responseModel = model;

  while (true) {
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
    yield {
      type: "token",
      delta: "",
      finishReason,
      model: responseModel,
      provider: provider.id,
      tokenUsage: usage,
    };
  }
}
