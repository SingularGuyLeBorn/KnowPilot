/**
 * Agent 解析 — 从 agentRuntime 抽出（W4）。
 *
 * 默认 assistant 的查找 / 创建。叶子模块：仅依赖 ServiceContainer 类型，
 * 不依赖 loop/reactLoop/agentTools/nativeTools，因此可被工具层安全引用。
 * 工具层（nativeTools）不直接 import 本文件做解析，而是通过 NativeToolContext.resolveAgent
 * 注入（见 agentTools.createAgentToolContext）；ctx 缺省时才回退到本模块的默认实现。
 *
 * W9：只读化。历史上本模块会在读路径「顺手 update」老库默认 assistant 的工具/提示词/层级，
 * 读路径写副作用违反「Markdown 为源、读路径纯净」原则。现改为：
 *   - 检测到配置漂移时只返回 drift 描述（调用方决定如何提示/消费），不做任何修改；
 *   - 老库修复走一次性迁移脚本 scripts/migrate-assistant-tools.ts。
 * （未找到默认 assistant 时的「创建」保留：这是首次启动的引导行为，不是读路径修补。）
 */

import type { ServiceContainer } from "./serviceContainer.js";
import type { AgentEntity } from "../services.js";
import { ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";
import { getAppConfig } from "./config.js";

/** 默认 assistant 工具清单单点定义在 shared（ASSISTANT_DEFAULT_TOOLS），此处不再另维护一份 */

export const DEFAULT_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。对于需要多步骤研究、耗时较长或需要并行的复杂任务，请使用 native:spawn_subagent 或 native:async_task_run 派生子代理执行，而不是在单轮对话中连续调用 read_article/web_search。用户偏好与跨会话稳定事实请用 native:memory_create 沉淀（必要时先 memory_search）；子 Agent 无记忆工具。当前会话上下文过长或用户要求压缩时，调用 native:session_compact（不换会话）；压缩成功后仅简短确认（如「压缩已完成」及条数），切勿复述摘要正文。话题明显切换或用户要求换干净上下文时，先写好总结再调用 native:session_rotate 归档并开新会话。";

const OUTDATED_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。";

/** 一次性迁移脚本的执行方式（drift 提示中引用） */
export const ASSISTANT_MIGRATION_HINT =
  "pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts";

export interface ResolveAgentResult {
  agent: AgentEntity;
  /** 默认 assistant 的配置漂移描述（空数组 = 无漂移）；指定 agentId 时恒为空 */
  drift: string[];
}

/**
 * 检测默认 assistant 相对内置默认配置的漂移（只读，不写库）。
 * 与迁移脚本 migrate-assistant-tools.ts 的修复逻辑一一对应。
 */
export function detectAssistantDrift(agent: AgentEntity): string[] {
  const drift: string[] = [];
  const tools = Array.isArray(agent.tools) ? agent.tools : [];
  // 子 Agent 不要求编排工具，其工具集由创建/运行时的权限层过滤
  const missingTools = ASSISTANT_DEFAULT_TOOLS.filter((t) => !tools.includes(t));
  if (agent.tier !== "sub" && missingTools.length > 0) {
    drift.push(`工具清单缺少 ${missingTools.length} 个内置默认工具（${missingTools.join(", ")}）`);
  }
  // 仅当系统提示还是旧版默认（或空）时报告，用户自定义提示词不算漂移
  if (!agent.systemPrompt || agent.systemPrompt === OUTDATED_ASSISTANT_SYSTEM_PROMPT) {
    drift.push("系统提示为空或为旧版默认");
  }
  // 默认 assistant 必须是 manager 层级；已明确指定 super/manager/sub 的 Agent 不算漂移
  if (!agent.tier) {
    drift.push("未设置 tier（应为 manager）");
  }
  return drift;
}

/** drift 提示的统一输出口（调用方消费方式之一：打 warn 日志） */
export function logAgentDrift(agentName: string, drift: string[]): void {
  if (drift.length === 0) return;
  console.warn(
    `[resolveAgent] Agent "${agentName}" 配置漂移：${drift.join("；")}。` +
      `resolveAgent 已只读化（W9），不再静默修改；请执行一次性迁移脚本修复：${ASSISTANT_MIGRATION_HINT}`,
  );
}

/** 默认 assistant 候选查找（keyword 搜索 + 精确名优先；不存在返回 null） */
async function findAssistantCandidate(services: ServiceContainer): Promise<AgentEntity | null> {
  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  return list.items.find((a: { name: string }) => a.name === "assistant") ?? list.items[0] ?? null;
}

export async function resolveAgent(services: ServiceContainer, agentId?: string): Promise<ResolveAgentResult> {
  if (agentId) return { agent: await services.agent.getById(agentId), drift: [] };

  const candidate = await findAssistantCandidate(services);

  // W9：只读 + drift 提示，不再顺手 update 数据库。
  // 注意：list 按 R19 裁剪了 systemPrompt，必须取全量实体才能做漂移检测，
  // 同时保证调用方拿到完整 systemPrompt（老代码靠「每次必 update」巧合地掩盖了这一点）。
  if (candidate) {
    let exact = candidate;
    try {
      exact = await services.agent.getById(candidate.id);
    } catch {
      // 并发删除时回退列表项
    }
    return { agent: exact, drift: detectAssistantDrift(exact) };
  }

  const created = await services.agent.create({
    name: "assistant",
    description: "KnowPilot 默认助手",
    model: getAppConfig().llm.defaultModel,
    systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    tools: ASSISTANT_DEFAULT_TOOLS,
    tier: "manager",
  });
  return { agent: created.data!, drift: [] };
}

/**
 * W16d-3：默认 assistant 漂移状态的只读查询（不创建、不修改），
 * 供 tRPC 通道暴露给 /agents 管理页横幅（drift 不再只有 server console.warn）。
 * 与 resolveAgent 不同：assistant 不存在时返回 agentId=null，绝不引导创建（管理页查询不得有写副作用）。
 */
export async function getAssistantDriftStatus(services: ServiceContainer): Promise<{
  agentId: string | null;
  agentName: string | null;
  drift: string[];
  migrationHint: string;
}> {
  const candidate = await findAssistantCandidate(services);
  if (!candidate) {
    return { agentId: null, agentName: null, drift: [], migrationHint: ASSISTANT_MIGRATION_HINT };
  }
  let exact = candidate;
  try {
    exact = await services.agent.getById(candidate.id);
  } catch {
    // 并发删除时回退列表项
  }
  return {
    agentId: exact.id,
    agentName: exact.name,
    drift: detectAssistantDrift(exact),
    migrationHint: ASSISTANT_MIGRATION_HINT,
  };
}

/** ctx 注入用函数类型（见 NativeToolContext.resolveAgent） */
export type ResolveAgentFn = typeof resolveAgent;
