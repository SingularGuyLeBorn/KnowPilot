/**
 * Prompt 构建 — 从 agentRuntime 抽出的叶子模块。
 *
 * 职责：纯字符串 / 记忆片段构建（buildMemoryContext、buildTierIdentityHint、buildAgentToolGuide、
 * buildSystemPromptSkeleton）。注入编排（何时拼进 system prompt）已迁至 contextHooks 内建钩子。
 * 不依赖 loop/reactLoop/agentTools/nativeTools。
 */

import type { ServiceContainer } from "./serviceContainer.js";
import {
  MEMORY_INJECTABLE_TYPES,
  memoryAgentScope,
  memoryWorkspaceScope,
  MEMORY_SCOPE_GLOBAL,
} from "@knowpilot/shared";
import { createMemoryRepository } from "./memoryRepository.js";
import {
  recordMemoryRetrieveOutcome,
  shouldSkipMemoryRetrieve,
} from "./memoryRetrieveGate.js";
import { ensurePinnedMemoryHint } from "./pinnedMemory.js";

/**
 * 构建注入 system prompt 的长期记忆片段。
 * W5：统一走 MemoryRepository（FTS 优先 / LIKE 回退；BM25×(1+strength)×recency 排序）；
 * W5-followup：三层 scope 读路径——global + workspace:{wid}（Agent 有 Workspace 时）+ agent:{aid}；
 * 门控：连续无命中后跳过若干轮检索（综述① retrieve-or-not）。
 */
export async function buildMemoryContext(
  services: ServiceContainer,
  userText: string,
  options?: { agentId?: string | null },
): Promise<string> {
  const keyword = userText.slice(0, 80).trim();
  if (!keyword) return "";
  const gateKey = options?.agentId ?? "__global__";
  if (shouldSkipMemoryRetrieve(gateKey)) {
    return "";
  }
  const scopes = [MEMORY_SCOPE_GLOBAL];
  if (options?.agentId) {
    const agent = await services.prisma.agent.findUnique({
      where: { id: options.agentId },
      select: { workspaceId: true },
    });
    if (agent?.workspaceId) scopes.push(memoryWorkspaceScope(agent.workspaceId));
    scopes.push(memoryAgentScope(options.agentId));
  }
  const repo = createMemoryRepository(services);
  const memories = await repo.read({
    keyword,
    types: [...MEMORY_INJECTABLE_TYPES],
    scopes,
    limit: 5,
  });
  recordMemoryRetrieveOutcome(gateKey, memories.length > 0);
  if (!memories.length) return "";

  // S6 轻量：同 content 去重（保留强度更高/更新的一条已在 repo 排序）
  const seen = new Set<string>();
  const unique = memories.filter((m) => {
    const key = m.content.trim().toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const now = Date.now();
  const lines = unique.map((m) => {
    const attr = m.attribution && m.attribution !== "agent" ? `/${m.attribution}` : "";
    const ageMs = m.updatedAt ? now - new Date(m.updatedAt).getTime() : 0;
    const stale =
      Number.isFinite(ageMs) && ageMs > 24 * 60 * 60 * 1000
        ? "（可能过时，需验证）"
        : "";
    return `- [${m.type}${attr}] ${m.content.slice(0, 300)}${stale}`;
  });
  return `\n\n## 相关长期记忆\n${lines.join("\n")}`;
}

/**
 * L1 常驻层（冻结）+ 动态 FTS 记忆（按轮检索）。
 * sessionId 有值时 USER/AGENT 快照会话内不变；动态层仍按 userText 检索。
 */
export async function buildAllMemoryHints(
  services: ServiceContainer,
  userText: string,
  options?: { agentId?: string | null; sessionId?: string | null },
): Promise<string> {
  const pinned = await ensurePinnedMemoryHint(services, options?.sessionId);
  const dynamic = await buildMemoryContext(services, userText, { agentId: options?.agentId });
  return pinned + dynamic;
}

const WEB_TOOL_GUIDE = `## 网络工具用法
- web_search：查最新信息、文档、新闻；返回标题+URL+摘要，优先用结果中的 URL 继续深挖。已配置 Tavily/SerpAPI 时按 SEARCH_ENGINE_PRIORITY 自动降级；在 /sources 启用信息源后，Tavily/SerpAPI 会优先在信息源域名内 scoped 搜索（hint 含 infoSource-scoped / N 信息源）。
- read_article：读取单篇网页正文（Markdown）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书/GitHub 等；GitHub blob→raw + jsDelivr/API（~1s）；InfoQ/OSChina API；SegmentFault/CSDN/掘金/博客园 SSR HTTP；简书 Mobile HTTP；知乎 Cookie HTTP（~1s，需 ZHIHU_COOKIE）；HTTP 404 秒级报错；正文偏短（<150 字）时返回 contentWarning 并建议 scrape_web_page。
- scrape_web_page：Playwright 采集复杂 SPA/需 JS 渲染页面；返回 method=playwright 与 platform；read_article 失败或页面高度动态时再试。
- browser_screenshot：打开页面截图（PNG）落盘，返回 path/publicUrl（无图片字节）。用于视觉确认布局、登录墙、图表、验证码页等；随后用 read_image。
- read_image：读图。path 用 screenshot 返回路径；也可传图片 URL。mode=ocr|vision|auto（默认 auto）。只回文本，勿期望 base64。
建议流程：web_search 找 URL → read_article 读正文 → 必要时 scrape_web_page；需要「看见页面」时 browser_screenshot → read_image。知乎/微信/小红书/抖音若被登录墙拦截，可在 .env 配置 ZHIHU_COOKIE / WECHAT_COOKIE / XHS_COOKIE / DOUYIN_COOKIE；GitHub 可选 GITHUB_TOKEN 提高 API 限速余量。`;

/** Hermes SKILLS_GUIDANCE：程序记忆 vs Memory（陈述事实） */
export const SKILLS_GUIDANCE = `## Skill 程序记忆（Hermes）
After completing a complex task (约 5+ tool calls)、攻克棘手错误、或发现可复用工作流，用 skill_manage 保存为 Skill，下次复用。
使用 Skill 时若发现过时/缺步/错误，立刻 skill_manage(action='patch')，不要等被要求。
加载：skills_list 看目录 → skill_view 读全文/references。procedural Skill 不会出现在 skill__* 工具列表里。
Memory 记「用户是谁/偏好」；Skill 记「这类任务怎么做」。禁止把一次性任务名（PR 号、今日 debug）当成 skill name。`;

/** 根据 Agent 已授权工具追加简短使用指引 */
export function buildAgentToolGuide(tools: string[]): string {
  const has = (name: string) => tools.some((t) => t === `native:${name}` || t === name);
  const parts: string[] = [];
  if (
    has("web_search") ||
    has("read_article") ||
    has("scrape_web_page") ||
    has("browser_screenshot") ||
    has("read_image")
  ) {
    parts.push(WEB_TOOL_GUIDE);
  }
  if (has("skills_list") || has("skill_view") || has("skill_manage")) {
    parts.push(SKILLS_GUIDANCE);
  }
  return parts.join("\n\n");
}

/** 按层级注入身份约束，防止子 Agent 误认自己是超级/管理 Agent */
export function buildTierIdentityHint(tier?: string | null, name?: string | null): string {
  if (tier === "sub") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份（硬约束）
你是子 Agent${who}，**不是**超级 Agent，也**不是**管理 Agent。
- 只执行上级下发的当前任务；**完成后必须调用 agent_report_back** 向上级交付正式结果（进父会话异步结果队列）。
- **agent_report_back vs agent_notify_parent（勿混用）**：
  - \`agent_report_back\` = 任务最终结果（完成/失败），正式交付，父 Agent 据此继续。
  - \`agent_notify_parent\` = 过程通知（进度、卡点、催问），进父会话待发消息队列，**不是**任务结果。
  - 禁止用 notify_parent 代替 report_back 交最终结果；过程中可先 notify，结束时仍要 report_back。
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

/**
 * System prompt 骨架（纯字符串）：缺省回退文案。
 * 记忆 / tier 身份 / 工具引导 / extras 由 contextHooks 内建钩子在 LLM 调用前注入。
 */
export function buildSystemPromptSkeleton(basePrompt: string): string {
  return basePrompt || "你是 KnowPilot 助手。";
}
