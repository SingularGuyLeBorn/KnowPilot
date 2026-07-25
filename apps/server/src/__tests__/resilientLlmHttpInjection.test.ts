/**
 * 弹性 LLM 客户端 — 真实 HTTP 错误注入端到端测试
 *
 * 与 resilientLlmClient.test.ts（fetch mock）互补：本测试起 in-process HTTP server，
 * 走真实 fetch 到 localhost，验证 resilientChatCompletion 在真实 HTTP 失败下的
 * 重试 / 降级 / 错误分类全链路（fetch mock 测不了真实 fetch 超时/连接/SSE 解析）。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "../infra/config.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";
import { resilientChatCompletion, LlmResilienceError } from "../infra/resilientLlmClient.js";

function makeConfig(baseUrl: string, overrides?: Partial<AppConfig["llm"]>): AppConfig {
  const config = createTestConfig(createTempProjectDir());
  config.llm = {
    ...config.llm,
    maxRetries: 2,
    baseDelayMs: 1,
    fallbackModels: [],
    providers: {
      deepseek: { apiKey: "sk-test", model: "deepseek-v4-flash", baseUrl },
      kimi: { apiKey: "sk-test", model: "kimi-k2", baseUrl },
      zhipu: { apiKey: "sk-test", model: "glm-4-flash", baseUrl },
      openai: { apiKey: "", model: "gpt-4o-mini", baseUrl },
    },
    ...overrides,
  };
  return config;
}

interface MockServer {
  url: string;
  server: http.Server;
  /** 累计收到的请求数（用于断言重试次数） */
  requests: () => number;
  /** 设置本轮注入的失败（按请求序递推；超出长度则用最后一项） */
  setFails: (fails: (string | null)[]) => void;
}

function startMockServer(): Promise<MockServer> {
  let reqCount = 0;
  let fails: (string | null)[] = [];
  const server = http.createServer((req, res) => {
    reqCount++;
    const fail = fails[Math.min(reqCount - 1, fails.length - 1)] ?? null;
    if (req.url?.startsWith("/health")) {
      res.end("ok");
      return;
    }
    // 读取 body（chatCompletion 需要，但这里只关心 header 注入）
    req.resume();
    if (fail === "timeout") {
      // 不响应，挂起（client timeout 会先到；这里用 60s 占位避免 server 端立即关）
      return;
    }
    if (fail === "network") {
      (res.socket as any)?.destroy?.();
      return;
    }
    if (fail) {
      const statusMap: Record<string, number> = {
        "400": 400, "401": 401, "403": 403, "413": 413, "429": 429, "500": 500, "502": 502, "503": 503, "504": 504,
      };
      const status = statusMap[fail] ?? (fail === "overflow" ? 400 : 500);
      const body =
        fail === "overflow"
          ? JSON.stringify({ error: { message: "context_length_exceeded: prompt is too long" } })
          : JSON.stringify({ error: { message: `Mock ${fail}` } });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    // 正常响应（OpenAI 协议）
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `mock-${reqCount}`,
        object: "chat.completion",
        model: "deepseek-v4-flash",
        choices: [{ index: 0, message: { role: "assistant", content: `ok-${reqCount}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        server,
        requests: () => reqCount,
        setFails: (f) => {
          reqCount = 0;
          fails = f;
        },
      });
    });
  });
}

describe("resilientChatCompletion — 真实 HTTP 错误注入", () => {
  let mock: MockServer;

  beforeEach(async () => {
    mock = await startMockServer();
  });

  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  it("401 → fatal，不重试，立即抛 LlmResilienceError(fatal, retryable=false)", async () => {
    mock.setFails(["401"]);
    const config = makeConfig(mock.url);
    await expect(
      resilientChatCompletion({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      classification: "fatal",
      retryable: false,
      status: 401,
    });
    expect(mock.requests()).toBe(1);
  });

  it("500 → retryable，重试 2 次后第 3 次成功", async () => {
    mock.setFails(["500", "500", null]);
    const config = makeConfig(mock.url);
    const result = await resilientChatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("ok-3");
    expect(mock.requests()).toBe(3);
  });

  it("429 重试耗尽 + fallback kimi-k2 成功 → 降级", async () => {
    // 主模型 deepseek-v4-flash 3 次全 429；fallback kimi-k2 第 1 次成功
    mock.setFails(["429", "429", "429", null]);
    const config = makeConfig(mock.url, { fallbackModels: ["kimi-k2"] });
    const result = await resilientChatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("ok-4");
    expect(result.model).toBe("deepseek-v4-flash"); // mock server 固定返回 deepseek-v4-flash
    expect(mock.requests()).toBe(4);
  });

  it("overflow 400 → overflow 分类，不重试，立即抛", async () => {
    mock.setFails(["overflow"]);
    const config = makeConfig(mock.url);
    await expect(
      resilientChatCompletion({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      classification: "overflow",
      retryable: false,
      status: 400,
    });
    expect(mock.requests()).toBe(1);
  });

  it("全链路耗尽（无 fallback）→ 抛 LlmResilienceError(retryable→exhausted, retryable=false)", async () => {
    mock.setFails(["500", "500", "500"]);
    const config = makeConfig(mock.url);
    await expect(
      resilientChatCompletion({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      retryable: false,
      status: 500,
    });
    expect(mock.requests()).toBe(3);
  });

  it("网络异常（socket destroy）→ retryable，重试后成功", async () => {
    mock.setFails(["network", null]);
    const config = makeConfig(mock.url);
    const result = await resilientChatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("ok-2");
    expect(mock.requests()).toBe(2);
  });

  it("成功路径不重试，单次请求", async () => {
    mock.setFails([null]);
    const config = makeConfig(mock.url);
    const result = await resilientChatCompletion({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("ok-1");
    expect(mock.requests()).toBe(1);
  });
});

import { resilientChatCompletionStream } from "../infra/resilientLlmClient.js";

function startMockStreamServer(): Promise<MockServer> {
  let reqCount = 0;
  let fails: (string | null)[] = [];
  const server = http.createServer((req, res) => {
    reqCount++;
    const fail = fails[Math.min(reqCount - 1, fails.length - 1)] ?? null;
    req.resume();
    if (fail === "timeout") return;
    if (fail === "network") {
      (res.socket as any)?.destroy?.();
      return;
    }
    if (fail) {
      const statusMap: Record<string, number> = { "401": 401, "429": 429, "500": 500, "503": 503 };
      const status = statusMap[fail] ?? 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Mock ${fail}` } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ model: "deepseek-v4-flash", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ model: "deepseek-v4-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        server,
        requests: () => reqCount,
        setFails: (f) => {
          reqCount = 0;
          fails = f;
        },
      });
    });
  });
}

describe("resilientChatCompletionStream — 真实 HTTP 错误注入", () => {
  let mock: MockServer;

  beforeEach(async () => {
    mock = await startMockStreamServer();
  });

  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  it("连接阶段 500 → 重试后成功", async () => {
    mock.setFails(["500", null]);
    const config = makeConfig(mock.url);
    const chunks: string[] = [];
    for await (const chunk of resilientChatCompletionStream({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "token" && chunk.delta) chunks.push(chunk.delta);
    }
    expect(chunks.join("")).toBe("ok");
    expect(mock.requests()).toBe(2);
  });

  it("连接阶段 401 → fatal，不重试，立即抛", async () => {
    mock.setFails(["401"]);
    const config = makeConfig(mock.url);
    await expect(async () => {
      for await (const _chunk of resilientChatCompletionStream({
        config,
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      })) {
        // drain
      }
    }).rejects.toMatchObject({ classification: "fatal", retryable: false, status: 401 });
    expect(mock.requests()).toBe(1);
  });

  it("成功路径不重试，单次请求", async () => {
    mock.setFails([null]);
    const config = makeConfig(mock.url);
    const chunks: string[] = [];
    for await (const chunk of resilientChatCompletionStream({
      config,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "token" && chunk.delta) chunks.push(chunk.delta);
    }
    expect(chunks.join("")).toBe("ok");
    expect(mock.requests()).toBe(1);
  });
});
