/**
 * Mock 场景定义数组 + 解析入口（从 server mockLlmClient.ts 迁出，单源）
 */

import type { MockLlmOptions, MockLlmScenario } from "./scenarios.js";
import {
  baseResult,
  hasAnyToolResult,
  hasTool,
  lastUserText,
  makeToolCall,
  mockLog,
  streamFromCompletion,
} from "./scenarios.js";
import type { LlmCompletionResult, StreamChunk } from "./types.js";

export const scenarios: MockLlmScenario[] = [
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
    name: "async_task_run",
    match: (opts, forced) => {
      if (forced === "async_task_run") return true;
      return hasTool(opts, "async_task_run") && /后台任务|异步任务|async task/i.test(lastUserText(opts)) && !hasAnyToolResult(opts);
    },
    completion: (opts) => ({
      ...baseResult(opts),
      content: hasAnyToolResult(opts) ? "已为你启动后台任务，结果会稍后自动插入对话。" : null,
      toolCalls: hasAnyToolResult(opts)
        ? []
        : [makeToolCall("async_task_run", { task: "总结当前项目", label: "项目总结", toolCall: { tool: "sleep", args: { seconds: 1 } } })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: hasAnyToolResult(opts) ? "已为你启动后台任务，结果会稍后自动插入对话。" : null,
        toolCalls: hasAnyToolResult(opts)
          ? []
          : [makeToolCall("async_task_run", { task: "总结当前项目", label: "项目总结", toolCall: { tool: "sleep", args: { seconds: 1 } } })],
      });
    },
  },
  {
    name: "spawn_subagent_notify",
    match: (opts, forced) =>
      forced === "spawn_subagent_notify" ||
      (/派子 Agent 通知|spawn notify/i.test(lastUserText(opts)) &&
        hasTool(opts, "spawn_subagent") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("spawn_subagent", { task: "通知父会话任务进度", waitForResult: true, label: "进度通知" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("spawn_subagent", { task: "通知父会话任务进度", waitForResult: true, label: "进度通知" })],
      });
    },
  },
  {
    name: "agent_notify_parent",
    match: (opts, forced) =>
      forced === "agent_notify_parent" ||
      (/通知父会话|notify parent/i.test(lastUserText(opts)) &&
        hasTool(opts, "agent_notify_parent") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("agent_notify_parent", { content: "子 Agent 进度通知：任务进行中" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("agent_notify_parent", { content: "子 Agent 进度通知：任务进行中" })],
      });
    },
  },
  {
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
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("web_search", { query: "KnowPilot" })],
      });
    },
  },
  {
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
    name: "spawn_subagent_notify_final",
    match: (opts, forced) =>
      forced === "spawn_subagent_notify_final" ||
      (hasAnyToolResult(opts) &&
        /派子 Agent 通知|spawn notify/i.test(lastUserText(opts)) &&
        hasTool(opts, "spawn_subagent")),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已派生子 Agent，它会向父会话发送进度通知。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "已派生子 Agent，它会向父会话发送进度通知。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
    name: "agent_notify_parent_final",
    match: (opts, forced) =>
      forced === "agent_notify_parent_final" ||
      (hasAnyToolResult(opts) &&
        /通知父会话|notify parent/i.test(lastUserText(opts)) &&
        !hasTool(opts, "spawn_subagent")),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已通知父会话，继续执行任务。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "已通知父会话，继续执行任务。";
      for (const token of content.split("")) {
        yield { type: "token", delta: token, model: opts.model, provider: "mock" };
      }
      yield { type: "token", delta: "", finishReason: "stop", model: opts.model, provider: "mock", tokenUsage: { prompt: 10, completion: 12, total: 22 } };
    },
  },
  {
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
    name: "agent_notify_parent_received",
    match: (opts, forced) =>
      forced === "agent_notify_parent_received" ||
      /子 Agent 进度通知|notify parent/i.test(lastUserText(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: "收到子 Agent 通知，继续等待完整结果。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      const content = "收到子 Agent 通知，继续等待完整结果。";
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
    name: "eval_G01_post_list",
    match: (opts, forced) =>
      forced === "eval_G01_post_list" ||
      (/列.*文章|知识库.*文章|最近的文章/i.test(lastUserText(opts)) &&
        hasTool(opts, "post_list") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("post_list", { page: 1, pageSize: 10 })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("post_list", { page: 1, pageSize: 10 })],
      });
    },
  },
  {
    name: "eval_G02_post_create",
    match: (opts, forced) =>
      forced === "eval_G02_post_create" ||
      (/保存成.*文章|保存.*知识库/i.test(lastUserText(opts)) &&
        hasTool(opts, "post_create") &&
        !hasAnyToolResult(opts)),
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("post_create", { title: "测试草稿", content: "草稿正文", garden: "posts" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("post_create", { title: "测试草稿", content: "草稿正文", garden: "posts" })],
      });
    },
  },
  {
    name: "eval_G03_read_article",
    match: (_opts, forced) => forced === "eval_G03_read_article",
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("read_article", { url: "https://zhuanlan.zhihu.com/p/12345678" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("read_article", { url: "https://zhuanlan.zhihu.com/p/12345678" })],
      });
    },
  },
  {
    name: "eval_G04_file_delete",
    match: (_opts, forced) => forced === "eval_G04_file_delete",
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("file_delete", { path: "draft-tmp.txt" })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("file_delete", { path: "draft-tmp.txt" })],
      });
    },
  },
  {
    name: "eval_G05_spawn_subagent",
    match: (_opts, forced) => forced === "eval_G05_spawn_subagent",
    completion: (opts) => ({
      ...baseResult(opts),
      content: "已派生子 Agent 异步调研。",
      toolCalls: [makeToolCall("spawn_subagent", { task: "调研本周 AI 开源热点", waitForResult: false })],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: "已派生子 Agent 异步调研。",
        toolCalls: [makeToolCall("spawn_subagent", { task: "调研本周 AI 开源热点", waitForResult: false })],
      });
    },
  },
  {
    name: "eval_G06_idle_chat",
    match: (_opts, forced) => forced === "eval_G06_idle_chat",
    completion: (opts) => ({
      ...baseResult(opts),
      content: "是啊，难得好天气，出去走走挺好的。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: "是啊，难得好天气，出去走走挺好的。",
        toolCalls: [],
      });
    },
  },
  {
    name: "eval_G07_compact",
    match: (_opts, forced) => forced === "eval_G07_compact",
    completion: (opts) => ({
      ...baseResult(opts),
      content: null,
      toolCalls: [makeToolCall("session_compact", {})],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: null,
        toolCalls: [makeToolCall("session_compact", {})],
      });
    },
  },
  {
    name: "eval_G08_stop",
    match: (_opts, forced) => forced === "eval_G08_stop",
    completion: (opts) => ({
      ...baseResult(opts),
      content: "好的，已停止，不再继续执行新任务。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content: "好的，已停止，不再继续执行新任务。",
        toolCalls: [],
      });
    },
  },
  {
    name: "eval_G09_list_tools",
    match: (_opts, forced) => forced === "eval_G09_list_tools",
    completion: (opts) => ({
      ...baseResult(opts),
      content:
        "我能搜索与读网页、管理知识库文章、读写 Workspace 文件、派生子 Agent、管理记忆与定时任务等；不会在回复里暴露任何 API Key。",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content:
          "我能搜索与读网页、管理知识库文章、读写 Workspace 文件、派生子 Agent、管理记忆与定时任务等；不会在回复里暴露任何 API Key。",
        toolCalls: [],
      });
    },
  },
  {
    name: "eval_G10_html_preview",
    match: (_opts, forced) => forced === "eval_G10_html_preview",
    completion: (opts) => ({
      ...baseResult(opts),
      content:
        "下面是可预览的计数页面：\n\n```html\n<!doctype html><html><body><button id=b>0</button><script>b.onclick=()=>b.textContent=++b.textContent</script></body></html>\n```",
      toolCalls: [],
    }),
    stream: async function* (opts) {
      yield* streamFromCompletion(opts, {
        ...baseResult(opts),
        content:
          "下面是可预览的计数页面：\n\n```html\n<!doctype html><html><body><button id=b>0</button><script>b.onclick=()=>b.textContent=++b.textContent</script></body></html>\n```",
        toolCalls: [],
      });
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

export function resolveScenario(opts: MockLlmOptions): MockLlmScenario {
  const forced = opts.scenario?.trim() || process.env.MOCK_LLM_SCENARIO?.trim();
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

export function registerMockLlmScenario(scenario: MockLlmScenario): void {
  scenarios.unshift(scenario);
}
