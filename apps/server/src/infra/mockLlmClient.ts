/**
 * Mock LLM Client —— 用于 E2E / 单元测试，避免依赖真实 LLM API。
 *
 * 通过环境变量启用：
 *   MOCK_LLM=true
 *   MOCK_LLM_SCENARIO=web_search   # 可选，强制指定场景
 *
 * 场景可基于用户消息关键词匹配，也可强制指定。
 */

import fs from "node:fs";
import type {
  LlmCompletionResult,
  LlmMessage,
  LlmToolCall,
  LlmToolDefinition,
  StreamChunk,
} from "./llmClient.js";

export interface MockLlmOptions {
  model?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
}

export interface MockLlmScenario {
  name: string;
  /** 是否匹配该场景；返回 true 则命中 */
  match: (opts: MockLlmOptions, forced?: string) => boolean;
  /** 非流式结果 */
  completion: (opts: MockLlmOptions) => LlmCompletionResult;
  /** 流式结果 */
  stream: (opts: MockLlmOptions) => AsyncGenerator<StreamChunk>;
}

function lastUserText(opts: MockLlmOptions): string {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (m.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content.map((p) => (p.type === "text" ? p.text ?? "" : "")).join("");
      }
    }
  }
  return "";
}

function hasTool(opts: MockLlmOptions, name: string): boolean {
  return opts.tools?.some((t) => t.function.name === name) ?? false;
}

function firstToolName(opts: MockLlmOptions, ...names: string[]): string | undefined {
  return opts.tools?.map((t) => t.function.name).find((n) => names.includes(n));
}

/**
 * 任意工具已返回结果 → 后续 probe 必须切到「最终回答」场景，
 * 否则会与 web_search / read_article 等场景互相命中导致 ReAct 死循环。
 */
function hasAnyToolResult(opts: MockLlmOptions): boolean {
  return opts.messages.some((m) => m.role === "tool");
}

const MOCK_LOG_PATH = process.env.MOCK_LLM_LOG ?? "";
function mockLog(line: string): void {
  if (!MOCK_LOG_PATH) return;
  try {
    fs.appendFileSync(MOCK_LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 忽略日志写入失败 */
  }
}

function makeToolCall(name: string, args: Record<string, unknown>): LlmToolCall {
  return {
    id: `mock_call_${name}_${Date.now()}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function baseResult(opts: MockLlmOptions): Omit<LlmCompletionResult, "content" | "reasoningContent" | "toolCalls"> {
  return {
    finishReason: "stop",
    model: opts.model || "mock-llm",
    provider: "mock",
    tokenUsage: { prompt: 10, completion: 12, total: 22 },
  };
}

async function* delayYield<T>(items: T[], ms = 8): AsyncGenerator<T> {
  for (const item of items) {
    await new Promise((r) => setTimeout(r, ms));
    yield item;
  }
}

/** 将 completion 结果转为 stream chunks（stream-first ReAct 依赖此路径产出 tool_calls） */
async function* streamFromCompletion(
  opts: MockLlmOptions,
  result: LlmCompletionResult,
): AsyncGenerator<StreamChunk> {
  if (result.reasoningContent) {
    for (const token of result.reasoningContent.split("")) {
      yield { type: "reasoning", delta: token, model: opts.model || "mock-llm", provider: "mock" };
    }
  }
  if (result.content) {
    for (const token of result.content.split("")) {
      yield { type: "token", delta: token, model: opts.model || "mock-llm", provider: "mock" };
    }
  }
  if (result.toolCalls.length > 0) {
    yield {
      type: "tool_calls",
      toolCalls: result.toolCalls,
      finishReason: "tool_calls",
      model: opts.model || "mock-llm",
      provider: "mock",
      tokenUsage: result.tokenUsage ?? { prompt: 10, completion: 12, total: 22 },
    };
    return;
  }
  yield {
    type: "token",
    delta: "",
    finishReason: "stop",
    model: opts.model || "mock-llm",
    provider: "mock",
    tokenUsage: result.tokenUsage ?? { prompt: 10, completion: 12, total: 22 },
  };
}

const scenarios: MockLlmScenario[] = [
  {
    name: "intermediate_content_final",
    match: (opts, forced) =>
      forced === "intermediate_content_final" ||
      (hasAnyToolResult(opts) && /中间回复|intermediate/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已完成工具调用，这是基于结果的最终回答。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "已完成工具调用，这是基于结果的最终回答。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    // 第一轮：返回中间正式回复 + web_search tool_call（验证中间回复进导轨）
    name: "intermediate_content",
    match: (opts, forced) =>
      forced === "intermediate_content" ||
      (/中间回复|intermediate/i.test(lastUserText(opts)) &&
        hasTool(opts, "web_search") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "我将先搜索相关资料，然后给出回答。",
      toolCalls: [makeToolCall("web_search", { query: "KnowPilot intermediate" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: "我将先搜索相关资料，然后给出回答。",
        toolCalls: [makeToolCall("web_search", { query: "KnowPilot intermediate" })],
      });
    },
  },
  {
    // 后台异步任务：第一轮调用 async_task_run，收到工具结果后给出最终回复
    name: "async_task_run",
    match: (opts, forced) => {
      if (forced === "async_task_run") return true;
      return hasTool(opts, "async_task_run") && /后台任务|异步任务|async task/i.test(lastUserText(opts)) && !hasAnyToolResult(opts);
    },
    completion: (opts) => ({
      ...baseResult(opts),
      content: hasAnyToolResult(opts) ? "已为你启动后台任务，结果会稍后自动插入对话。" : null,
      toolCalls: hasAnyToolResult(opts) ? [] : [makeToolCall("async_task_run", { task: "总结当前项目", label: "项目总结" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: hasAnyToolResult(opts) ? "已为你启动后台任务，结果会稍后自动插入对话。" : null,
        toolCalls: hasAnyToolResult(opts) ? [] : [makeToolCall("async_task_run", { task: "总结当前项目", label: "项目总结" })],
      });
    },
  },
  {
    // 父 Agent 阻塞派生子 Agent（waitForResult=true），用于验证刷新/切 tab 后流式恢复
    name: "spawn_subagent_wait",
    match: (opts, forced) =>
      forced === "spawn_subagent_wait" ||
      (/派子 Agent|spawn subagent/i.test(lastUserText(opts)) &&
        hasTool(opts, "spawn_subagent") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("spawn_subagent", { task: "执行慢速总结", waitForResult: true, label: "慢速总结" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("spawn_subagent", { task: "执行慢速总结", waitForResult: true, label: "慢速总结" })],
      });
    },
  },
  {
    // 子 Agent 执行慢速任务（sleep 3s），给前端足够时间刷新/断连来测试续传
    name: "subagent_slow",
    match: (opts, forced) =>
      forced === "subagent_slow" ||
      (/执行慢速总结|subagent slow/i.test(lastUserText(opts)) &&
        hasTool(opts, "sleep") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("sleep", { seconds: 3 })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("sleep", { seconds: 3 })],
      });
    },
  },
  {
    name: "web_search_final",
    match: (opts, forced) =>
      forced === "web_search_final" ||
      (hasAnyToolResult(opts) && /搜索|search|KnowPilot/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已完成 web_search，Mock 搜索返回：KnowPilot 是一个本地优先的智能知识管理平台。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "已完成 web_search，Mock 搜索返回：KnowPilot 是一个本地优先的智能知识管理平台。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    // 工具失败后的最终回答：与 red pill 一致地输出失败摘要文案
    name: "tool_error_final",
    match: (opts, forced) =>
      forced === "tool_error_final" ||
      (hasAnyToolResult(opts) && /坏掉|broken|失败|error/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "读取文章失败：Mock 404，无法获取正文。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "读取文章失败：Mock 404，无法获取正文。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    name: "read_article_final",
    match: (opts, forced) =>
      forced === "read_article_final" ||
      (hasAnyToolResult(opts) && /读取文章|read article|juejin|掘金/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已完成 read_article，Mock 文章正文已读取。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "已完成 read_article，Mock 文章正文已读取。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    name: "web_search",
    match: (opts, forced) =>
      forced === "web_search" ||
      (/搜索|search|KnowPilot/i.test(lastUserText(opts)) &&
        hasTool(opts, "web_search") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("web_search", { query: "KnowPilot" })],
    }),
    // stream-first：必须在 stream 中产出 tool_calls（不再依赖非流式 probe）
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("web_search", { query: "KnowPilot" })],
      });
    },
  },
  {
    // 注意：tool_error 必须排在 read_article 之前，否则消息含 broken 时会被 read_article 先命中
    name: "tool_error",
    match: (opts, forced) =>
      forced === "tool_error" ||
      (/坏掉|broken|失败|error/i.test(lastUserText(opts)) &&
        hasTool(opts, "read_article") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("read_article", { url: "https://example.com/broken" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("read_article", { url: "https://example.com/broken" })],
      });
    },
  },
  {
    name: "read_article",
    match: (opts, forced) =>
      forced === "read_article" ||
      (/读取文章|read article|juejin|掘金/i.test(lastUserText(opts)) &&
        hasTool(opts, "read_article") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("read_article", { url: "https://juejin.cn/post/mock" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("read_article", { url: "https://juejin.cn/post/mock" })],
      });
    },
  },
  {
    // 父 Agent 收到子 Agent 结果后继续生成最终回复
    name: "spawn_subagent_final",
    match: (opts, forced) =>
      forced === "spawn_subagent_final" ||
      (hasAnyToolResult(opts) && /派子 Agent|spawn subagent/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "父 Agent 已收到子 Agent 结果：慢速总结已完成。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "父 Agent 已收到子 Agent 结果：慢速总结已完成。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    // 子 Agent 完成慢速任务后返回结果
    name: "subagent_slow_final",
    match: (opts, forced) =>
      forced === "subagent_slow_final" ||
      (hasAnyToolResult(opts) && /执行慢速总结|subagent slow/i.test(lastUserText(opts))),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "子 Agent 慢速总结已完成。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "子 Agent 慢速总结已完成。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    name: "thinking",
    match: (opts, forced) =>
      forced === "thinking" ||
      /思考|reasoning|explain|解释/i.test(lastUserText(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "这是 Mock LLM 给出的最终回答。",
      reasoningContent: "让我逐步思考：用户希望看到思考链，因此我生成一段推理过程。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const reasoning = "让我逐步思考：";
      for (const token of reasoning.split("")) {
        yield { type: "reasoning", delta: token, model: opts.model, provider: "mock" };
      }
      const content = "这是 Mock LLM 给出的最终回答。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    name: "greeting",
    match: () => true,
    completion: (opts) => ({
      ...baseResult(opts),
      content: "你好！我是 Mock LLM，正在为你服务。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "你好！我是 Mock LLM，正在为你服务。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
];

function resolveScenario(opts: MockLlmOptions): MockLlmScenario {
  const forced = process.env.MOCK_LLM_SCENARIO?.trim();
  const lastText = lastUserText(opts);
  const toolNames = opts.messages.filter((m) => m.role === "tool").map((m) => m.name);
  mockLog(
    `resolve lastUserText="${lastText.slice(0, 40)}" tools=${JSON.stringify(opts.tools?.map((t) => t.function.name) ?? [])} toolResults=${JSON.stringify(toolNames)}`,
  );
  for (const s of scenarios) {
    if (s.match(opts, forced)) {
      mockLog(`matched scenario: ${s.name}`);
      return s;
    }
  }
  mockLog(`fallback scenario: ${scenarios[scenarios.length - 1].name}`);
  return scenarios[scenarios.length - 1];
}

export async function mockChatCompletion(options: MockLlmOptions): Promise<LlmCompletionResult> {
  const scenario = resolveScenario(options);
  return scenario.completion(options);
}

export async function* mockChatCompletionStream(options: MockLlmOptions): AsyncGenerator<StreamChunk> {
  const scenario = resolveScenario(options);
  yield* scenario.stream(options);
}

/** 注册自定义场景（单元测试可用） */
export function registerMockLlmScenario(scenario: MockLlmScenario): void {
  scenarios.unshift(scenario);
}
