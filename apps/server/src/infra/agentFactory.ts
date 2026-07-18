/**
 * AgentFactory — 三 tier Agent 默认模板与创建（W9）
 *
 * super / manager / sub 三个 tier 的默认模板（systemPrompt / tools / heartbeat）
 * 统一从 `content/agents/_templates/{tier}.md` 读取（frontmatter 格式同普通 agent 文件，
 * 额外支持 heartbeat 段与 `{{name}}` 占位符）；模板目录以 `_` 开头，sync 会跳过（见 sync/utils.ts）。
 *
 * 读不到模板时 fallback 到 shared 常量（TIER_DEFAULT_TOOLS / DEFAULT_LLM_MODEL）+
 * 本文件内置的兜底文案，并 console.warn 一次/tier。
 *
 * 叶子模块：仅依赖 config / shared / gray-matter，不依赖 loop / agentRuntime，
 * 可被 swarmInitializer、workspaceProvision、loop/setup 安全引用。
 */

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { PrismaClient, Agent, Prisma } from "@prisma/client";
import { TIER_DEFAULT_TOOLS, DEFAULT_LLM_MODEL, type AgentTier } from "@knowpilot/shared";
import { getAppConfig } from "./config.js";

/* ─── 类型 ─── */

export interface AgentTierTemplate {
  tier: AgentTier;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  heartbeat: Record<string, unknown> | null;
}

export interface CreateAgentForTierInput {
  tier: AgentTier;
  /** 最终 Agent 名；缺省用模板 name（模板中的 {{name}} 占位符由 vars 渲染） */
  name?: string;
  /** 模板变量（如 manager 模板的 {{name}} = Workspace 名） */
  vars?: Record<string, string>;
  overrides?: {
    description?: string;
    model?: string;
    systemPrompt?: string;
    tools?: string[];
    workspaceId?: string | null;
    parentId?: string | null;
    heartbeat?: Record<string, unknown> | null;
    status?: string;
  };
}

/* ─── 兜底模板（模板文件缺失时的安全网；正式模板见 content/agents/_templates/） ─── */

const SUPER_FALLBACK_PROMPT = `你是 KnowPilot 的超级 Agent，用户的全权代理。

你的能力：
- 创建 Workspace（创建后自动生成该 Workspace 的管理 Agent）
- 创建/编辑/删除任何 Agent（但不能删除自己或其他超级 Agent）
- 跨 Workspace 协调（其他 Agent 不能跨 Workspace）
- 通过心跳机制自主运行，定时检查任务并下发命令
- 查看任何 Agent 的完整上下文（agent_inspect 工具）
- 在系统 Workspace 下创建子 Agent 执行专项任务（如 Skill 推广、全局审计）

你的心跳任务：
- 检查所有 Workspace 的状态
- 整理待办事项
- 如有需要，给管理 Agent 下发命令
- 发现优秀 Skill 可跨 Workspace 推广

所有操作会被审计记录。你不可删除自己或其他超级 Agent。`;

const MANAGER_FALLBACK_PROMPT = `你是 {{name}} 的管理 Agent。
你的职责是管理本 Workspace 内的子 Agent，接收来自超级 Agent 或用户的命令并执行/分配。
你可以创建子 Agent，可以与子 Agent 通信，可以向上级回报结果。`;

const SUB_FALLBACK_PROMPT = `你是 KnowPilot 的子 Agent，专注于执行上级下发的具体任务。
收到任务后独立执行，完成后必须调用 agent_report_back 向上级交付正式结果（进异步结果队列）。
过程通知用 agent_notify_parent（进父会话待发消息），不要用它代替 report_back 交最终结果。
你不能创建其他 Agent，也不能跨 Workspace 操作。`;

const SUPER_FALLBACK_HEARTBEAT: Record<string, unknown> = {
  enabled: true,
  cron: "0 9 * * *",
  goal: "检查所有 Workspace 状态，整理待办，如有需要给管理 Agent 下发命令",
  lastRunAt: null,
  lastRunStatus: null,
  consecutiveFailures: 0,
};

const FALLBACK_TEMPLATES: Record<AgentTier, AgentTierTemplate> = {
  super: {
    tier: "super",
    name: "KnowPilot 超级 Agent",
    description:
      "KnowPilot 默认超级 Agent，首次启动自动创建。拥有全部 Agent CRUD 权限与心跳自主运行能力。",
    systemPrompt: SUPER_FALLBACK_PROMPT,
    tools: TIER_DEFAULT_TOOLS.super,
    heartbeat: SUPER_FALLBACK_HEARTBEAT,
  },
  manager: {
    tier: "manager",
    name: "{{name}} 管理 Agent",
    description: "{{name}} Workspace 的管理 Agent",
    systemPrompt: MANAGER_FALLBACK_PROMPT,
    tools: TIER_DEFAULT_TOOLS.manager,
    heartbeat: null,
  },
  sub: {
    tier: "sub",
    name: "{{name}}",
    description: "执行上级下发的具体任务的子 Agent",
    systemPrompt: SUB_FALLBACK_PROMPT,
    tools: TIER_DEFAULT_TOOLS.sub,
    heartbeat: null,
  },
};

/* ─── 模板读取（按 tier + 文件 mtime 缓存；fallback 警告每 tier 只打一次） ─── */

const templateCache = new Map<AgentTier, { mtimeMs: number; template: AgentTierTemplate }>();
const fallbackWarned = new Set<AgentTier>();

function getTemplatePath(tier: AgentTier): string {
  return path.join(getAppConfig().contentPaths.agents, "_templates", `${tier}.md`);
}

function renderVars(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m);
}

function loadTierTemplate(tier: AgentTier): AgentTierTemplate {
  const filePath = getTemplatePath(tier);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const cached = templateCache.get(tier);
  if (cached && cached.mtimeMs === mtimeMs) return cached.template;

  let template: AgentTierTemplate;
  if (mtimeMs > 0) {
    try {
      const { data, content } = matter(fs.readFileSync(filePath, "utf-8"));
      const fallback = FALLBACK_TEMPLATES[tier];
      const tools = Array.isArray(data.tools)
        ? data.tools.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : [];
      template = {
        tier,
        name: typeof data.name === "string" && data.name.trim() ? data.name : fallback.name,
        description:
          typeof data.description === "string" && data.description.trim()
            ? data.description
            : fallback.description,
        systemPrompt: content.trim() || fallback.systemPrompt,
        tools: tools.length > 0 ? tools : [...TIER_DEFAULT_TOOLS[tier]],
        heartbeat:
          data.heartbeat && typeof data.heartbeat === "object"
            ? {
                enabled: true,
                cron: "0 9 * * *",
                goal: "",
                lastRunAt: null,
                lastRunStatus: null,
                consecutiveFailures: 0,
                ...(data.heartbeat as Record<string, unknown>),
              }
            : null,
      };
    } catch (err) {
      console.warn(`[agentFactory] 模板解析失败 ${filePath}，回退内置常量:`, err instanceof Error ? err.message : err);
      template = FALLBACK_TEMPLATES[tier];
    }
  } else {
    if (!fallbackWarned.has(tier)) {
      fallbackWarned.add(tier);
      console.warn(`[agentFactory] 未找到模板 ${filePath}，tier=${tier} 使用内置常量兜底`);
    }
    template = FALLBACK_TEMPLATES[tier];
  }

  templateCache.set(tier, { mtimeMs, template });
  return template;
}

/** 测试隔离：清空模板缓存（模板文件变更后下次读取会自动按 mtime 刷新，通常无需调用） */
export function resetAgentTemplateCacheForTests(): void {
  templateCache.clear();
  fallbackWarned.clear();
}

/**
 * 获取某 tier 的默认模板（模板文件优先，缺失回退 W8 常量 + 内置文案）。
 * `vars` 用于渲染模板中的 {{key}} 占位符（如 manager 的 {{name}} = Workspace 名）。
 */
export function getTierTemplate(tier: AgentTier, opts?: { vars?: Record<string, string> }): AgentTierTemplate {
  const base = loadTierTemplate(tier);
  return {
    ...base,
    tools: [...base.tools],
    heartbeat: base.heartbeat ? { ...base.heartbeat } : null,
    name: renderVars(base.name, opts?.vars),
    description: renderVars(base.description, opts?.vars),
    systemPrompt: renderVars(base.systemPrompt, opts?.vars),
  };
}

/**
 * 按 tier 模板创建 Agent（prisma 直写；需要文件写回/FTS 的场景请走 services.agent.create，
 * 默认值可取 getTierTemplate）。model 缺省取全局 config.llm.defaultModel。
 */
export async function createAgentForTier(prisma: PrismaClient, input: CreateAgentForTierInput): Promise<Agent> {
  const template = getTierTemplate(input.tier, { vars: input.vars });
  const overrides = input.overrides ?? {};
  const data: Prisma.AgentUncheckedCreateInput = {
    name: input.name ?? renderVars(template.name, input.vars),
    description: overrides.description ?? template.description,
    model: overrides.model ?? getAppConfig().llm.defaultModel ?? DEFAULT_LLM_MODEL,
    systemPrompt: overrides.systemPrompt ?? template.systemPrompt,
    tools: (overrides.tools ?? template.tools).join(","),
    tier: input.tier,
    status: overrides.status ?? "active",
  };
  if (overrides.workspaceId != null) data.workspaceId = overrides.workspaceId;
  if (overrides.parentId != null) data.parentId = overrides.parentId;
  const heartbeat = overrides.heartbeat !== undefined ? overrides.heartbeat : template.heartbeat;
  if (heartbeat != null) data.heartbeat = heartbeat as Prisma.InputJsonValue;
  const agent = await prisma.agent.create({ data });
  // prisma 直写绕过 AgentService.afterCreate，此处补主会话（幂等）
  const { ensureMainSession } = await import("./ensureMainSession.js");
  await ensureMainSession(prisma, {
    agentId: agent.id,
    title: `${agent.name} 主会话`,
    model: agent.model,
  }).catch((err) => {
    console.warn(`[agentFactory] ensureMainSession 失败 agentId=${agent.id}:`, err);
  });
  return agent;
}
