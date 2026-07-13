/**
 * 弹性 LLM 客户端 — 装饰器模式包装 llmClient 内核
 *
 * 三层防御（对齐 architecture-audit-2026-07「LLM 零重试零降级」整改）：
 * 1. 错误分类：fatal（401/403/400/422）/ retryable（408/409/425/429/5xx/网络异常）/ degradable（重试耗尽且有备用厂商）
 * 2. 指数退避 + jitter 重试；MOCK_LLM=true 时跳过等待但保留重试逻辑路径
 * 3. 重试耗尽后按 config.llm.fallbackModels 顺序降级（provider 由 inferProviderFromModel 推导）
 *
 * 流式路径特殊规则：仅「连接建立阶段」（首个 chunk 之前）失败可重试/降级；
 * 已开始输出 token 后失败不重试（避免重复输出），只分类上抛。
 */

import type { AppConfig } from "./config.js";
import {
  chatCompletion,
  chatCompletionStream,
  inferProviderFromModel,
  LlmHttpError,
} from "./llmClient.js";

/* ─── 错误分类 ─── */

export type LlmErrorClass = "fatal" | "retryable" | "degradable";

export interface ClassifyOptions {
  /** 本轮重试是否已耗尽 */
  retriesExhausted?: boolean;
  /** 是否配置了可用的备用模型 */
  hasFallback?: boolean;
}

/**
 * LLM 错误分类：
 * - 401/403 → fatal（API Key 无效，重试无意义）
 * - 400/422 → fatal（请求参数不被接受）
 * - 408/409/425/429/5xx、网络异常（status=null）→ retryable
 * - retryable 重试耗尽且配置了备用厂商 → degradable
 */
export function classifyLlmError(
  status: number | null,
  _body: string,
  opts?: ClassifyOptions,
): LlmErrorClass {
  const retryable =
    status === null ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500;

  if (retryable) {
    return opts?.retriesExhausted && opts?.hasFallback ? "degradable" : "retryable";
  }
  // 401/403/400/422 及其余 4xx：请求本身有问题，重试不会改变结果
  return "fatal";
}

/** 分类对应的用户指引（error 事件 suggestion / 错误消息后缀） */
export function suggestionForClass(cls: LlmErrorClass, status: number | null): string {
  if (cls === "fatal") {
    if (status === 401 || status === 403) {
      return "请检查 API Key 是否有效（.env 中对应厂商密钥）。";
    }
    return "请求参数不被厂商接受，请检查模型名与请求配置。";
  }
  if (cls === "degradable") {
    return "已按 fallbackModels 自动降级仍全部失败，请检查网络与各厂商额度。";
  }
  return "厂商限流或网络抖动，可稍后重试。";
}

/** 弹性层抛出的错误：携带分类、retryable 与用户指引，供 agentRuntime/agentStream 直接消费 */
export class LlmResilienceError extends Error {
  constructor(
    message: string,
    public readonly classification: LlmErrorClass,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly suggestion: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmResilienceError";
  }
}

export interface LlmErrorDescription {
  retryable: boolean;
  suggestion: string;
}

/**
 * 统一描述捕获到的错误：LLM 错误按分类真实填充 retryable/suggestion，
 * 非 LLM 错误保持原有默认（可重试 + 通用建议），不引入回归。
 */
export function describeLlmError(err: unknown, fallbackSuggestion: string): LlmErrorDescription {
  if (err instanceof LlmResilienceError) {
    return { retryable: err.retryable, suggestion: err.suggestion };
  }
  if (err instanceof LlmHttpError) {
    const cls = classifyLlmError(err.status, err.body);
    return { retryable: cls === "retryable", suggestion: suggestionForClass(cls, err.status) };
  }
  return { retryable: true, suggestion: fallbackSuggestion };
}

/* ─── 弹性包装 ─── */

export interface LlmClientCore {
  chatCompletion: typeof chatCompletion;
  chatCompletionStream: typeof chatCompletionStream;
}

export interface ResilienceDefaults {
  maxRetries?: number;
  baseDelayMs?: number;
  jitter?: boolean;
  fallbackModels?: string[];
}

type ChatCompletionOptions = Parameters<typeof chatCompletion>[0];
type ChatCompletionStreamOptions = Parameters<typeof chatCompletionStream>[0];

interface ResolvedPolicy {
  maxRetries: number;
  baseDelayMs: number;
  jitter: boolean;
  fallbackModels: string[];
}

function resolvePolicy(config: AppConfig, defaults?: ResilienceDefaults): ResolvedPolicy {
  return {
    maxRetries: config.llm.maxRetries ?? defaults?.maxRetries ?? 3,
    baseDelayMs: config.llm.baseDelayMs ?? defaults?.baseDelayMs ?? 1000,
    jitter: defaults?.jitter ?? true,
    fallbackModels:
      (config.llm.fallbackModels?.length ? config.llm.fallbackModels : defaults?.fallbackModels) ?? [],
  };
}

/** 从捕获错误中提取 HTTP 状态（网络异常 / 超时为 null） */
function statusOf(err: unknown): number | null {
  return err instanceof LlmHttpError ? err.status : null;
}

function bodyOf(err: unknown): string {
  if (err instanceof LlmHttpError) return err.body;
  return err instanceof Error ? err.message : String(err);
}

/** 用户中断 / Abort 不重试，原样上抛（agentStream 依赖 AbortError 名识别中断） */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (err instanceof Error && err.name === "AbortError");
}

/** 指数退避 + jitter；MOCK_LLM 下跳过等待（mock 路径本就不会失败，此处仅为防御） */
async function backoff(attempt: number, baseDelayMs: number, jitter: boolean): Promise<void> {
  if (process.env.MOCK_LLM === "true") return;
  const exp = baseDelayMs * 2 ** attempt;
  const delay = jitter ? exp * (0.5 + Math.random() * 0.5) : exp;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** 组装可尝试的模型链：原模型（options 原样）+ fallbackModels（去重、去自身、跳过未配置 Key 的厂商） */
function buildModelChain(options: ChatCompletionOptions, policy: ResolvedPolicy): (string | undefined)[] {
  const chain: (string | undefined)[] = [options.model];
  const seen = new Set<string>(options.model ? [options.model] : []);
  for (const raw of policy.fallbackModels) {
    const model = raw.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    // 备用厂商未配置 API Key 时直接跳过，避免浪费一轮重试预算
    try {
      inferProviderFromModel(options.config, model);
    } catch {
      continue;
    }
    chain.push(model);
  }
  return chain;
}

/** fatal 错误：立即终止，包装指引后上抛 */
function wrapFatal(err: unknown, prefix: string): LlmResilienceError {
  const status = statusOf(err);
  const cls = classifyLlmError(status, bodyOf(err));
  const suggestion = suggestionForClass(cls, status);
  return new LlmResilienceError(
    `${prefix}（${status === null ? "网络异常" : `HTTP ${status}`}）：${suggestion}原始错误：${
      err instanceof Error ? err.message : String(err)
    }`,
    "fatal",
    status,
    false,
    suggestion,
    err,
  );
}

/** 全链路耗尽：重试 + 降级全部失败后才抛出，retryable=false */
function buildExhaustedError(
  lastErr: unknown,
  degradedModels: string[],
  maxRetries: number,
  prefix: string,
): LlmResilienceError {
  const status = statusOf(lastErr);
  const hasFallback = degradedModels.length > 0;
  const cls = classifyLlmError(status, bodyOf(lastErr), {
    retriesExhausted: true,
    hasFallback,
  });
  const suggestion = suggestionForClass(cls, status);
  const degradeNote = hasFallback ? `已自动降级到 ${degradedModels.join(" → ")} 仍失败。` : "";
  return new LlmResilienceError(
    `${prefix}：重试 ${maxRetries + 1} 次后仍失败。${degradeNote}${suggestion}原始错误：${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
    cls,
    status,
    false,
    suggestion,
    lastErr,
  );
}

/**
 * 弹性装饰器：返回与内核同形的 client，不改 llmClient 签名。
 * 每次调用从 options.config.llm 读取 maxRetries / baseDelayMs / fallbackModels（config.yaml 驱动）。
 */
export function withResilience(client: LlmClientCore, defaults?: ResilienceDefaults): LlmClientCore {
  async function resilientChatCompletion(options: ChatCompletionOptions) {
    const policy = resolvePolicy(options.config, defaults);
    const chain = buildModelChain(options, policy);
    const degraded: string[] = [];
    let lastErr: unknown = new Error("未知 LLM 错误");

    for (let mi = 0; mi < chain.length; mi++) {
      const model = chain[mi];
      const attemptOptions = mi === 0 ? options : { ...options, model };
      if (mi > 0 && model) degraded.push(model);

      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        try {
          const result = await client.chatCompletion(attemptOptions);
          if (mi > 0 && model) {
            console.warn(`[resilientLlm] 主模型重试耗尽，已自动降级到 ${model}`);
          }
          return result;
        } catch (err) {
          if (isAbort(err, options.signal)) throw err;
          lastErr = err;
          const cls = classifyLlmError(statusOf(err), bodyOf(err));
          if (cls === "fatal") throw wrapFatal(err, "LLM 请求被拒绝");
          if (attempt < policy.maxRetries) {
            await backoff(attempt, policy.baseDelayMs, policy.jitter);
          }
        }
      }
    }

    throw buildExhaustedError(lastErr, degraded, policy.maxRetries, "LLM 请求失败");
  }

  async function* resilientChatCompletionStream(options: ChatCompletionStreamOptions) {
    const policy = resolvePolicy(options.config, defaults);
    const chain = buildModelChain(options, policy);
    const degraded: string[] = [];
    let lastErr: unknown = new Error("未知 LLM 错误");

    for (let mi = 0; mi < chain.length; mi++) {
      const model = chain[mi];
      const attemptOptions = mi === 0 ? options : { ...options, model };
      if (mi > 0 && model) degraded.push(model);

      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        const gen = client.chatCompletionStream(attemptOptions);
        let first: IteratorResult<Awaited<ReturnType<typeof gen.next>>["value"]>;
        try {
          // 连接建立阶段：首个 chunk 之前的失败可重试 / 降级
          first = await gen.next();
        } catch (err) {
          if (isAbort(err, options.signal)) throw err;
          lastErr = err;
          const cls = classifyLlmError(statusOf(err), bodyOf(err));
          if (cls === "fatal") throw wrapFatal(err, "LLM 流式请求被拒绝");
          if (attempt < policy.maxRetries) {
            await backoff(attempt, policy.baseDelayMs, policy.jitter);
            continue;
          }
          break; // 本模型重试耗尽 → 尝试降级链下一个模型
        }

        if (mi > 0 && model) {
          console.warn(`[resilientLlm] 流式主模型重试耗尽，已自动降级到 ${model}`);
        }
        if (!first.done) yield first.value;
        try {
          // 已开始输出 token：失败不重试（避免重复输出），只分类上抛
          yield* gen;
          return;
        } catch (err) {
          if (isAbort(err, options.signal)) throw err;
          const status = statusOf(err);
          const cls = classifyLlmError(status, bodyOf(err));
          const suggestion = "流式输出中途断开（已输出内容不会重发），请重新发送消息。";
          throw new LlmResilienceError(
            `LLM 流式输出中断（${status === null ? "网络异常" : `HTTP ${status}`}）：${suggestion}原始错误：${
              err instanceof Error ? err.message : String(err)
            }`,
            cls === "fatal" ? "fatal" : "retryable",
            status,
            false,
            suggestion,
            err,
          );
        }
      }
    }

    throw buildExhaustedError(lastErr, degraded, policy.maxRetries, "LLM 流式请求失败");
  }

  return {
    chatCompletion: resilientChatCompletion,
    chatCompletionStream: resilientChatCompletionStream,
  };
}
