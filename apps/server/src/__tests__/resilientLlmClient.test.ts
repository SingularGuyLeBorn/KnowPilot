/**
 * 弹性 LLM 客户端测试 — 错误分类 / 指数退避重试 / fallback 降级 / MOCK_LLM 直通
 *
 * 全部走 fetch mock，无真实网络。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import { chatCompletion, chatCompletionStream, type StreamChunk } from "../infra/llmClient.js";
import {
  classifyLlmError,
  withResilience,
  LlmResilienceError,
} from "../infra/resilientLlmClient.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

/* ─── 测试配置 ─── */

function makeConfig(overrides?: Partial<AppConfig["llm"]>): AppConfig {
  const config = createTestConfig(createTempProjectDir());
  config.llm = {
    ...config.llm,
    maxRetries: 3,
    baseDelayMs: 5,
    fallbackModels: [],
    providers: {
      deepseek: { apiKey: "sk-deepseek-test", model: "deepseek-v4-flash", baseUrl: "" },
      kimi: { apiKey: "sk-kimi-test", model: "kimi-latest", baseUrl: "" },
      zhipu: { apiKey: "sk-zhipu-test", model: "glm-4-flash", baseUrl: "" },
      // openai 在 map 中但无 Key（对齐生产 createAppConfig 形态）→ fallback 应跳过
      openai: { apiKey: "", model: "gpt-4o-mini", baseUrl: "" },
    },
    ...overrides,
  };
  return config;
}

/* ─── fetch mock ─── */

interface FetchStep {
  status: number;
  body?: string;
  /** 模拟网络异常：fetch 直接 reject */
  reject?: Error;
}

function jsonBody(content: string, model: string): string {
  return JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    model,
  });
}

function sseBody(text: string, model: string): string {
  return `data: ${JSON.stringify({ model, choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function makeFetchMock(steps: FetchStep[]) {
  const urls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (url: unknown) => {
    urls.push(String(url));
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.reject) throw step.reject;
    return new Response(step.body ?? "", { status: step.status });
  });
  return { fn, urls, count: () => i };
}

function makeStreamFetchMock(steps: Array<{ status: number; sse?: string; streamError?: Error }>) {
  const urls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (url: unknown) => {
    urls.push(String(url));
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.status !== 200) {
      return new Response("rate limited", { status: step.status });
    }
    // 注意：undici Response 会提前消费源流，start() 里 enqueue 后立刻 error 会丢 chunk；
    // 用 pull 按消费节奏投递，保证首个 chunk 先送达、后续 read 才报错（模拟中途断流）
    let pullStep = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullStep += 1;
        if (pullStep === 1) {
          controller.enqueue(new TextEncoder().encode(step.sse ?? ""));
        } else if (step.streamError) {
          controller.error(step.streamError);
        } else {
          controller.close();
        }
      },
    });
    return new Response(stream, { status: 200 });
  });
  return { fn, urls, count: () => i };
}

beforeEach(() => {
  delete process.env.MOCK_LLM;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MOCK_LLM;
});

/* ─── classifyLlmError ─── */

describe("classifyLlmError 错误分类", () => {
  it("401/403 → fatal（API Key 问题）", () => {
    expect(classifyLlmError(401, "unauthorized")).toBe("fatal");
    expect(classifyLlmError(403, "forbidden")).toBe("fatal");
  });

  it("400/422 → fatal（请求参数问题）", () => {
    expect(classifyLlmError(400, "bad request")).toBe("fatal");
    expect(classifyLlmError(422, "unprocessable")).toBe("fatal");
  });

  it("408/409/425/429/5xx → retryable", () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
      expect(classifyLlmError(status, "")).toBe("retryable");
    }
  });

  it("网络异常 / 超时（无状态码）→ retryable", () => {
    expect(classifyLlmError(null, "fetch failed")).toBe("retryable");
  });

  it("retryable 重试耗尽且配置了备用厂商 → degradable", () => {
    expect(classifyLlmError(429, "", { retriesExhausted: true, hasFallback: true })).toBe("degradable");
    expect(classifyLlmError(null, "", { retriesExhausted: true, hasFallback: true })).toBe("degradable");
    // 无备用厂商时保持 retryable 语义
    expect(classifyLlmError(429, "", { retriesExhausted: true, hasFallback: false })).toBe("retryable");
  });
});

/* ─── chatCompletion 弹性路径 ─── */

describe("withResilience(chatCompletion)", () => {
  const client = withResilience({ chatCompletion, chatCompletionStream }, { jitter: false });

  it("429 → 指数退避后重试成功", async () => {
    const config = makeConfig({ maxRetries: 3, baseDelayMs: 5 });
    const mock = makeFetchMock([
      { status: 429, body: "too many requests" },
      { status: 429, body: "too many requests" },
      { status: 200, body: jsonBody("hello", "deepseek-v4-flash") },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const result = await client.chatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello");
    expect(mock.count()).toBe(3);
  });

  it("401 → 立即 fatal，不重试，retryable=false，指引检查 API Key", async () => {
    const config = makeConfig();
    const mock = makeFetchMock([{ status: 401, body: "invalid api key" }]);
    vi.stubGlobal("fetch", mock.fn);

    const err = await client
      .chatCompletion({ config, model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmResilienceError);
    const llmErr = err as LlmResilienceError;
    expect(llmErr.classification).toBe("fatal");
    expect(llmErr.retryable).toBe(false);
    expect(llmErr.message).toContain("请检查 API Key");
    expect(mock.count()).toBe(1);
  });

  it("重试耗尽 → 按 fallbackModels 降级到备用模型并成功", async () => {
    const config = makeConfig({ maxRetries: 1, baseDelayMs: 1, fallbackModels: ["kimi-k2"] });
    const mock = makeFetchMock([
      { status: 429, body: "limited" }, // 主模型第 1 次
      { status: 429, body: "limited" }, // 主模型重试 1 次（耗尽）
      { status: 200, body: jsonBody("from kimi", "kimi-k2") }, // 降级到 kimi
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const result = await client.chatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("from kimi");
    expect(result.provider).toBe("kimi");
    expect(mock.count()).toBe(3);
    expect(mock.urls.some((u) => u.includes("moonshot"))).toBe(true);
  });

  it("降级链全部耗尽 → 抛错，classification=degradable，retryable=false", async () => {
    const config = makeConfig({ maxRetries: 0, baseDelayMs: 1, fallbackModels: ["kimi-k2"] });
    const mock = makeFetchMock([
      { status: 500, body: "server error" },
      { status: 503, body: "unavailable" },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const err = await client
      .chatCompletion({ config, model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmResilienceError);
    const llmErr = err as LlmResilienceError;
    expect(llmErr.classification).toBe("degradable");
    expect(llmErr.retryable).toBe(false);
    expect(llmErr.message).toContain("已自动降级到 kimi-k2");
    expect(mock.count()).toBe(2);
  });

  it("fallback 厂商未配置 API Key → 跳过该模型继续降级", async () => {
    const config = makeConfig({ maxRetries: 0, baseDelayMs: 1, fallbackModels: ["gpt-4o-mini", "kimi-k2"] });
    // openai 未配置 key → gpt-4o-mini 应被跳过
    const mock = makeFetchMock([
      { status: 500, body: "err" },
      { status: 200, body: jsonBody("kimi ok", "kimi-k2") },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const result = await client.chatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("kimi ok");
    expect(mock.count()).toBe(2);
    expect(mock.urls.some((u) => u.includes("openai.com"))).toBe(false);
  });

  it("MOCK_LLM=true → 直通 mock 客户端，弹性层不触发 fetch、不等待", async () => {
    process.env.MOCK_LLM = "true";
    const config = makeConfig({ maxRetries: 3, baseDelayMs: 5000 });
    const mock = makeFetchMock([]);
    vi.stubGlobal("fetch", mock.fn);

    const started = Date.now();
    const result = await client.chatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "讲个笑话" }],
    });

    expect(mock.count()).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(typeof result.content === "string" || result.content === null).toBe(true);
  });
});

/* ─── chatCompletionStream 弹性路径 ─── */

describe("withResilience(chatCompletionStream)", () => {
  const client = withResilience({ chatCompletion, chatCompletionStream }, { jitter: false });

  async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const chunks: StreamChunk[] = [];
    for await (const c of gen) chunks.push(c);
    return chunks;
  }

  it("连接建立阶段 429 → 重试后成功流式输出", async () => {
    const config = makeConfig({ maxRetries: 2, baseDelayMs: 1 });
    const mock = makeStreamFetchMock([
      { status: 429 },
      { status: 200, sse: sseBody("stream ok", "deepseek-v4-flash") },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const chunks = await collect(
      client.chatCompletionStream({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(chunks.some((c) => c.type === "token" && c.delta === "stream ok")).toBe(true);
    expect(mock.count()).toBe(2);
  });

  it("已开始输出 token 后失败 → 不重试，分类上抛，fetch 仅 1 次", async () => {
    const config = makeConfig({ maxRetries: 3, baseDelayMs: 1 });
    const mock = makeStreamFetchMock([
      { status: 200, sse: sseBody("partial", "deepseek-v4-flash"), streamError: new Error("connection reset") },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const chunks: StreamChunk[] = [];
    const err = await (async () => {
      try {
        for await (const c of client.chatCompletionStream({
          config,
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "hi" }],
        })) {
          chunks.push(c);
        }
        return null;
      } catch (e) {
        return e;
      }
    })();

    expect(err).toBeInstanceOf(LlmResilienceError);
    expect((err as LlmResilienceError).retryable).toBe(false);
    expect(chunks.some((c) => c.delta === "partial")).toBe(true);
    expect(mock.count()).toBe(1);
  });

  it("流式连接阶段重试耗尽 → 降级到 fallback 模型", async () => {
    const config = makeConfig({ maxRetries: 0, baseDelayMs: 1, fallbackModels: ["kimi-k2"] });
    const mock = makeStreamFetchMock([
      { status: 503 },
      { status: 200, sse: sseBody("kimi stream", "kimi-k2") },
    ]);
    vi.stubGlobal("fetch", mock.fn);

    const chunks = await collect(
      client.chatCompletionStream({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(chunks.some((c) => c.delta === "kimi stream")).toBe(true);
    expect(mock.urls.some((u) => u.includes("moonshot"))).toBe(true);
  });
});
