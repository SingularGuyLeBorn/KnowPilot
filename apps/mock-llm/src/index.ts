/**
 * KnowPilot Mock LLM Server — OpenAI 协议兼容的本地 Mock 服务
 *
 * 用途：项目测试时把 LLM baseUrl 指向本服务（http://localhost:3040/v1），
 * 即可走真实 HTTP 路径（fetch/SSE/超时/错误分类/重试降级全覆盖），
 * 无需真实 API Key、不花一分钱、稳定可复现。
 *
 * 切换：.env 设 DEEPSEEK_BASE_URL=http://localhost:3040/v1（或 config.yaml llm.providers.*.baseUrl），
 *       API Key 随便填（本服务不校验）。无需 MOCK_LLM=true（走真实 HTTP，但打到 mock）。
 *
 * 错误注入（请求 header，不污染 OpenAI 协议）：
 *   x-mock-fail: 429|500|401|400|413|timeout|network|overflow  → 模拟对应失败
 *   x-mock-delay-ms: 500                                          → 响应前延迟
 *   x-mock-stream-break: after-5                                  → 流式第 5 个 chunk 后断连
 *   x-mock-scenario: web_search                                   → 强制指定场景（等价 MOCK_LLM_SCENARIO）
 *
 * 端点：
 *   POST /v1/chat/completions  （非流式 + stream:true SSE）
 *   GET  /v1/models            （返回预设模型列表）
 *   GET  /health               （健康检查）
 */

import express from "express";
import {
  mockChatCompletion,
  mockChatCompletionStream,
  type LlmMessage,
  type LlmToolDefinition,
  type StreamChunk,
} from "@knowpilot/mock-llm-core";

const PORT = parseInt(process.env.MOCK_LLM_PORT || "3040", 10);

const app = express();
app.use(express.json({ limit: "10mb" }));

function headerStr(req: express.Request, name: string): string {
  const v = req.headers[name];
  return typeof v === "string" ? v.trim() : "";
}

/** 应用错误注入；返回 true 表示已响应（调用方应终止） */
function applyFailInjection(req: express.Request, res: express.Response): boolean {
  const fail = headerStr(req, "x-mock-fail");
  if (!fail) return false;
  const delayMs = Math.max(0, parseInt(headerStr(req, "x-mock-delay-ms") || "0", 10));
  const send = (status: number, body: unknown) => {
    setTimeout(() => {
      if (!res.headersSent) res.status(status).json(body);
    }, delayMs);
  };
  if (fail === "timeout") {
    // 不响应，挂起到客户端超时；用一个长定时器占位（客户端会先超时）
    setTimeout(() => {}, 600_000);
    return true;
  }
  if (fail === "network") {
    // 模拟连接重置：直接 destroy socket
    setTimeout(() => {
      (res.socket as any)?.destroy?.();
    }, delayMs);
    return true;
  }
  const statusMap: Record<string, number> = {
    "400": 400, "401": 401, "403": 403, "413": 413, "429": 429, "500": 500, "502": 502, "503": 503, "504": 504,
  };
  const status = statusMap[fail] ?? (fail === "overflow" ? 400 : 500);
  const body =
    fail === "overflow"
      ? { error: { message: "context_length_exceeded: prompt is too long", type: "invalid_request_error" } }
      : { error: { message: `Mock injected ${fail}`, type: "mock_injection" } };
  send(status, body);
  return true;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mock-llm", port: PORT });
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "deepseek-v4-flash", object: "model", owned_by: "mock" },
      { id: "kimi-k2", object: "model", owned_by: "mock" },
      { id: "mock-llm", object: "model", owned_by: "mock" },
    ],
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  const delayMs = Math.max(0, parseInt(headerStr(req, "x-mock-delay-ms") || "0", 10));
  const scenarioOverride = headerStr(req, "x-mock-scenario");

  if (applyFailInjection(req, res)) return;

  const body = req.body as {
    model?: string;
    messages: LlmMessage[];
    tools?: LlmToolDefinition[];
    stream?: boolean;
  };
  const opts = {
    model: body.model,
    messages: body.messages ?? [],
    tools: body.tools,
    scenario: scenarioOverride || undefined,
  };

  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

  if (!body.stream) {
    const result = await mockChatCompletion(opts);
    res.json({
      id: `mock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.content,
            reasoning_content: result.reasoningContent,
            tool_calls: result.toolCalls.length
              ? result.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: { name: tc.function.name, arguments: tc.function.arguments },
                }))
              : undefined,
          },
          finish_reason: result.finishReason ?? "stop",
        },
      ],
      usage: result.tokenUsage
        ? {
            prompt_tokens: result.tokenUsage.prompt,
            completion_tokens: result.tokenUsage.completion,
            total_tokens: result.tokenUsage.total,
          }
        : undefined,
    });
    return;
  }

  // 流式 SSE
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const breakAfter = parseInt(headerStr(req, "x-mock-stream-break").replace(/^after-/, "") || "0", 10);
  let chunkIndex = 0;
  const writeSse = (event: string, data: unknown) => {
    if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const chunk of mockChatCompletionStream(opts) as AsyncGenerator<StreamChunk>) {
      if (breakAfter > 0 && chunkIndex >= breakAfter) {
        // 模拟流式中途断连
        (res.socket as any)?.destroy?.();
        return;
      }
      const sseData: Record<string, unknown> = {
        id: `mock-${Date.now()}`,
        object: "chat.completion.chunk",
        model: chunk.model ?? body.model ?? "mock-llm",
        choices: [
          {
            index: 0,
            delta:
              chunk.type === "token"
                ? { content: chunk.delta ?? "" }
                : chunk.type === "reasoning"
                ? { reasoning_content: chunk.delta ?? "" }
                : chunk.type === "tool_calls"
                ? { tool_calls: chunk.toolCalls?.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } })) }
                : {},
            finish_reason: chunk.finishReason ?? null,
          },
        ],
      };
      if (chunk.tokenUsage) {
        sseData.usage = {
          prompt_tokens: chunk.tokenUsage.prompt,
          completion_tokens: chunk.tokenUsage.completion,
          total_tokens: chunk.tokenUsage.total,
        };
      }
      writeSse("chat.completion.chunk", sseData);
      chunkIndex++;
    }
    writeSse("done", "[DONE]");
  } catch (err) {
    writeSse("error", { message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`\n  🧪 KnowPilot Mock LLM Server running at http://localhost:${PORT}`);
  console.log(`  📡 OpenAI-compatible: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  💚 Health:            http://localhost:${PORT}/health`);
  console.log(`  \n  切换方式：.env 设 DEEPSEEK_BASE_URL=http://localhost:${PORT}/v1，API Key 随便填`);
  console.log(`  错误注入：x-mock-fail=429|500|401|timeout|network|overflow, x-mock-delay-ms=500, x-mock-stream-break=after-5\n`);
});
