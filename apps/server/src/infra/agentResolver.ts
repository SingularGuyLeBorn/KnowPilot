/**
 * Agent 解析 — 从 agentRuntime 抽出（W4）。
 *
 * 默认 assistant 的查找 / 自动补齐 / 创建。叶子模块：仅依赖 ServiceContainer 类型，
 * 不依赖 loop/reactLoop/agentTools/nativeTools，因此可被工具层安全引用。
 * 工具层（nativeTools）不直接 import 本文件做解析，而是通过 NativeToolContext.resolveAgent
 * 注入（见 agentTools.createAgentToolContext）；ctx 缺省时才回退到本模块的默认实现。
 */

import type { ServiceContainer } from "./serviceContainer.js";

const DEFAULT_ASSISTANT_TOOLS = [
  "native:web_search",
  "native:read_article",
  "native:scrape_web_page",
  "native:read_file",
  "native:write_file",
  "native:list_directory",
  "native:invoke_api",
  "native:spawn_subagent",
  "native:async_task_run",
  "native:session_rotate",
  "native:session_compact",
  "native:sleep",
  "native:git_status",
  "native:memory_create",
  "native:memory_search",
  "skill:*",
  "mcp:filesystem",
];

const DEFAULT_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。对于需要多步骤研究、耗时较长或需要并行的复杂任务，请使用 native:spawn_subagent 或 native:async_task_run 派生子代理执行，而不是在单轮对话中连续调用 read_article/web_search。用户偏好与跨会话稳定事实请用 native:memory_create 沉淀（必要时先 memory_search）；子 Agent 无记忆工具。当前会话上下文过长或用户要求压缩时，调用 native:session_compact（不换会话）；压缩成功后仅简短确认（如「压缩已完成」及条数），切勿复述摘要正文。话题明显切换或用户要求换干净上下文时，先写好总结再调用 native:session_rotate 归档并开新会话。";

const LEGACY_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。";

export async function resolveAgent(services: ServiceContainer, agentId?: string) {
  if (agentId) return services.agent.getById(agentId);

  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  let exact = list.items.find((a: { name: string }) => a.name === "assistant");
  if (!exact && list.items[0]) exact = list.items[0];

  // 自动补齐默认 assistant 的工具与系统提示，确保老数据库也能获得子代理/写文件能力
  if (exact) {
    const tools = Array.isArray(exact.tools) ? exact.tools : [];
    // 子 Agent 不自动追加 spawn/async_task_run 等编排工具，其工具集由创建/运行时的权限层过滤
    const needsToolsUpdate =
      exact.tier !== "sub" &&
      (!tools.includes("native:write_file") ||
        !tools.includes("native:spawn_subagent") ||
        !tools.includes("native:async_task_run") ||
        !tools.includes("native:session_rotate") ||
        !tools.includes("native:session_compact") ||
        !tools.includes("native:memory_create") ||
        !tools.includes("native:memory_search"));
    // 仅当系统提示还是旧版默认（或空）时才自动升级，避免覆盖用户自定义提示词
    const needsPromptUpdate =
      !exact.systemPrompt || exact.systemPrompt === LEGACY_ASSISTANT_SYSTEM_PROMPT;
    // 默认 assistant 必须是 manager 层级；已明确指定 super/manager/sub 的 Agent 不再改动
    const needsTierUpdate = !exact.tier;
    const needsUpdate = needsToolsUpdate || needsPromptUpdate || needsTierUpdate;
    if (needsUpdate) {
      try {
        const updated = await services.agent.update({
          id: exact.id,
          tools: Array.from(new Set([...tools, ...DEFAULT_ASSISTANT_TOOLS])),
          ...(needsPromptUpdate ? { systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT } : {}),
          ...(needsTierUpdate ? { tier: "manager" } : {}),
        });
        if (updated.success && updated.data) {
          return updated.data;
        }
      } catch (err) {
        console.warn("[resolveAgent] 更新默认 assistant 工具/层级失败:", err);
      }
    }
    return exact;
  }

  const created = await services.agent.create({
    name: "assistant",
    description: "KnowPilot 默认助手",
    model: "deepseek-v4-flash",
    systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    tools: DEFAULT_ASSISTANT_TOOLS,
    tier: "manager",
  });
  return created.data!;
}

/** ctx 注入用函数类型（见 NativeToolContext.resolveAgent） */
export type ResolveAgentFn = typeof resolveAgent;
