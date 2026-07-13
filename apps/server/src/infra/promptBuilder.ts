/**
 * Prompt 构建 — 从 agentRuntime 抽出（W4）。
 *
 * 背景：历史循环依赖环 agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime，
 * 根因是 nativeTools 值导入 agentRuntime 的 prompt 构建函数。本文件是叶子模块：
 * 仅依赖 ServiceContainer 类型、FTS 索引与 shared 常量，**不依赖** loop/reactLoop/agentTools/nativeTools。
 * 新代码请直接引本文件，不要再从 agentRuntime 引入（agentRuntime 仅保留兼容 re-export）。
 */

import type { ServiceContainer } from "./serviceContainer.js";
import { searchFts } from "./ftsIndex.js";
import { isMemoryInjectable } from "@knowpilot/shared";

export async function buildMemoryContext(services: ServiceContainer, userText: string): Promise<string> {
  const keyword = userText.slice(0, 80).trim();
  if (!keyword) return "";
  // R11：优先 FTS 召回 memory（已索引，P11），避免 LIKE 扫 content 全表；FTS 无命中/不可用回退 LIKE
  let memories: any[] = [];
  try {
    const hits = await searchFts(services.prisma, keyword, 5);
    const memIds = hits.filter((h) => h.entity === "memory").map((h) => h.entityId);
    if (memIds.length > 0) {
      memories = await services.prisma.memory.findMany({
        where: { id: { in: memIds }, type: { not: "experience" } },
      });
    }
  } catch {
    // FTS 未就绪等，回退 LIKE
  }
  if (memories.length === 0) {
    const fb = await services.memory.list({ page: 1, pageSize: 8, keyword });
    memories = fb.items.filter((m) => isMemoryInjectable(m.type));
  } else {
    memories = memories.filter((m) => isMemoryInjectable(m.type));
  }
  if (!memories.length) return "";
  const lines = memories.slice(0, 5).map((m) => `- [${m.type}] ${m.content.slice(0, 300)}`);
  return `\n\n## 相关长期记忆\n${lines.join("\n")}`;
}

const WEB_TOOL_GUIDE = `## 网络工具用法
- web_search：查最新信息、文档、新闻；返回标题+URL+摘要，优先用结果中的 URL 继续深挖。已配置 Tavily/SerpAPI 时按 SEARCH_ENGINE_PRIORITY 自动降级；在 /sources 启用信息源后，Tavily/SerpAPI 会优先在信息源域名内 scoped 搜索（hint 含 infoSource-scoped / N 信息源）。
- read_article：读取单篇网页正文（Markdown）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书/GitHub 等；GitHub blob→raw + jsDelivr/API（~1s）；InfoQ/OSChina API；SegmentFault/CSDN/掘金/博客园 SSR HTTP；简书 Mobile HTTP；知乎 Cookie HTTP（~1s，需 ZHIHU_COOKIE）；HTTP 404 秒级报错；正文偏短（<150 字）时返回 contentWarning 并建议 scrape_web_page。
- scrape_web_page：Playwright 采集复杂 SPA/需 JS 渲染页面；返回 method=playwright 与 platform；read_article 失败或页面高度动态时再试。
建议流程：web_search 找 URL → read_article 读正文 → 必要时 scrape_web_page。知乎/微信/小红书/抖音若被登录墙拦截，可在 .env 配置 ZHIHU_COOKIE / WECHAT_COOKIE / XHS_COOKIE / DOUYIN_COOKIE；GitHub 可选 GITHUB_TOKEN 提高 API 限速余量。`;

/** 根据 Agent 已授权工具追加简短使用指引 */
export function buildAgentToolGuide(tools: string[]): string {
  const has = (name: string) => tools.some((t) => t === `native:${name}` || t === name);
  if (has("web_search") || has("read_article") || has("scrape_web_page")) {
    return WEB_TOOL_GUIDE;
  }
  return "";
}

/** 按层级注入身份约束，防止子 Agent 误认自己是超级/管理 Agent */
export function buildTierIdentityHint(tier?: string | null, name?: string | null): string {
  if (tier === "sub") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份（硬约束）
你是子 Agent${who}，**不是**超级 Agent，也**不是**管理 Agent。
- 只执行上级下发的当前任务；完成后必须调用 agent_report_back 向上级汇报。
- 异步任务（如 sleep async）到期后续跑时，仍应继续完成任务并 agent_report_back，不要把续跑当成「用户闲聊」。
- 用户在本会话直接发消息时，也可酌情 report_back（补充汇报），但请在内容中说明这是补充。
- 禁止创建/派生子 Agent 或管理其他 Agent（不得使用 spawn_subagent、agent_create、agent_create_sub 等）。
- 禁止创建或归档 Workspace；不要自称超级 Agent / 管理 Agent。
- 可用 sleep / 读写 / 搜索等执行类工具完成任务本身。`;
  }
  if (tier === "manager") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是管理 Agent${who}，负责**当前 Workspace** 内的子 Agent。
- 可在本 Workspace 创建/派生子 Agent；不可跨 Workspace，也不可创建 Workspace。
- 不要自称超级 Agent。`;
  }
  if (tier === "super") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是超级 Agent${who}，可跨 Workspace 管理；创建子 Agent 时应指定目标 Workspace（默认落在当前上下文 Workspace）。`;
  }
  return "";
}

export function buildSystemPromptWithHints(
  basePrompt: string,
  tools: string[],
  memoryHint: string,
  identity?: { tier?: string | null; name?: string | null },
): string {
  const identityHint = buildTierIdentityHint(identity?.tier, identity?.name);
  const base = (basePrompt || "你是 KnowPilot 助手。") + identityHint + memoryHint;
  const guide = buildAgentToolGuide(tools);
  return guide ? `${base}\n\n${guide}` : base;
}
