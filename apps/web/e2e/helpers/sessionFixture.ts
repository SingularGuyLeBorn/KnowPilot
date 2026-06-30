/**
 * E2E 夹具：创建「仅有用户消息、无助手回复」的会话（模拟流式中断场景）
 */

import { trpcMutate, trpcQuery } from "./trpcE2e";

export interface UserOnlySessionFixture {
  sessionId: string;
  title: string;
  userMessageId: string;
}

type ApiResult<T> = { success: boolean; data?: T; error?: { message?: string } };
type AgentList = { items: Array<{ id: string; name: string; model: string; systemPrompt: string }> };

export async function createUserOnlySession(): Promise<UserOnlySessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 思考重复 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  const msgRes = await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "用 list_directory 工具查看 content/agents 目录，一句话回复有哪些文件",
  });
  if (!msgRes.success || !msgRes.data) {
    throw new Error(msgRes.error?.message ?? "message.create 失败");
  }

  return {
    sessionId,
    title,
    userMessageId: msgRes.data.id,
  };
}

export interface ToolHintSessionFixture {
  sessionId: string;
  title: string;
}

/** 创建含 web_search 工具摘要的历史会话（断言 buildTimelineFromStored hint） */
export async function createSessionWithToolHints(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 工具摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "搜索 KnowPilot 并一句话介绍",
  });

  const toolCalls = [
    {
      id: "call_fixture_web_search",
      name: "web_search",
      args: { query: "KnowPilot" },
      result: {
        elapsedMs: 88,
        engine: "tavily",
        searchPhase: "smart-search",
        query: "KnowPilot",
        total: 3,
      },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "KnowPilot 是本地优先的知识管理与 Agent 平台。",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "KnowPilot 是本地优先的知识管理与 Agent 平台。",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}

/** 创建含 infoSource-scoped web_search 摘要的历史会话 */
export async function createSessionWithInfoSourceScopedHint(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 信息源搜索摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "在 DeepSeek 官方文档里查 API",
  });

  const toolCalls = [
    {
      id: "call_fixture_info_scoped",
      name: "web_search",
      args: { query: "DeepSeek API" },
      result: {
        elapsedMs: 156,
        provider: "tavily",
        searchPhase: "infoSource-scoped",
        infoSourcesUsed: [{ name: "DeepSeek 官方文档" }],
        query: "DeepSeek API",
        total: 2,
      },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "在官方文档站点找到相关 API 说明。",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "在官方文档站点找到相关 API 说明。",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}

/** 创建含 read_article 失败摘要的历史会话 */
export async function createSessionWithFailedToolHint(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 工具失败摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "读取某篇被拦截的文章",
  });

  const toolCalls = [
    {
      id: "call_fixture_read_fail",
      name: "read_article",
      args: { url: "https://example.com/blocked" },
      result: { error: "页面不可用或已删除 · cnblogs · 404 页面不存在 - 博客园", elapsedMs: 42 },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "无法读取该页面正文。",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "无法读取该页面正文。",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}

/** 创建含 read_article 成功摘要（平台/方法/字数）的历史会话 */
export async function createSessionWithReadArticleHint(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E read_article 摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "读取掘金文章",
  });

  const toolCalls = [
    {
      id: "call_fixture_read_ok",
      name: "read_article",
      args: { url: "https://juejin.cn/post/123" },
      result: {
        elapsedMs: 650,
        platform: "juejin",
        method: "http",
        contentChars: 3200,
        contentTruncated: false,
      },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "文章要点如下…",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "文章要点如下…",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}

/** 创建含 read_article 短正文 + suggestedTool 摘要的历史会话 */
export async function createSessionWithShortArticleHint(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 短正文摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "读取 B 站视频简介",
  });

  const toolCalls = [
    {
      id: "call_fixture_read_short",
      name: "read_article",
      args: { url: "https://www.bilibili.com/video/BV1GJ411x7h7" },
      result: {
        elapsedMs: 520,
        platform: "bilibili",
        method: "inline-script-json",
        contentChars: 120,
        contentWarning: "正文较短",
        suggestedTool: "scrape_web_page",
      },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "视频元信息较短，建议用 scrape_web_page 进一步采集。",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "视频元信息较短，建议用 scrape_web_page 进一步采集。",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}

/** 创建含 scrape_web_page 成功摘要的历史会话 */
export async function createSessionWithScrapeHint(): Promise<ToolHintSessionFixture> {
  const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E scrape 摘要 ${Date.now()}`;
  const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  if (!sessionRes.success || !sessionRes.data) {
    throw new Error(sessionRes.error?.message ?? "session.create 失败");
  }
  const sessionId = sessionRes.data.id;

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "user",
    content: "采集文档站首页",
  });

  const toolCalls = [
    {
      id: "call_fixture_scrape",
      name: "scrape_web_page",
      args: { url: "https://api-docs.deepseek.com/" },
      result: {
        elapsedMs: 900,
        method: "playwright",
        platform: "unknown",
        textChars: 2899,
        textTruncated: false,
      },
      kind: "tool",
    },
  ];

  await trpcMutate<ApiResult<{ id: string }>>("message.create", {
    sessionId,
    role: "assistant",
    content: "页面正文已采集。",
    toolCalls,
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content: "页面正文已采集。",
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  });

  return { sessionId, title };
}
