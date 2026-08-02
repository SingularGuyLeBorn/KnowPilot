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
 *   - 老库的一次性迁移脚本已执行并退役，漂移修复走人工对齐（见 ASSISTANT_MIGRATION_HINT）。
 * （未找到默认 assistant 时的「创建」保留：这是首次启动的引导行为，不是读路径修补。）
 */

import type { ServiceContainer } from "./serviceContainer.js";
import type { AgentEntity } from "./entityServices/agentService.js";
import { ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";
import { getAppConfig } from "./config.js";

/** 与 swarmInitializer.SYSTEM_WORKSPACE_TYPE_ASSISTANT 同源字面量（避免循环依赖） */
const ASSISTANT_HOME_SYSTEM_TYPE = "assistant";

/** 默认 assistant 工具清单单点定义在 shared（ASSISTANT_DEFAULT_TOOLS），此处不再另维护一份 */

/** 默认 assistant 系统提示（Markdown 分段；工具 id 仍为 snake_case 供模型调用） */
export const DEFAULT_ASSISTANT_SYSTEM_PROMPT = `你是 OasisMind (见微) 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。

## 任务编排
- 多步骤研究、耗时较长或需并行时，用 \`native:spawn_subagent\` 派生子代理。
- \`native:async_task_run\` 仅后台执行纯工具（不跑 LLM、不派生子代理）。
- 不要在单轮里连续堆 \`read_article\` / \`web_search\` 代替派活。

## 记忆
- 用户偏好与跨会话稳定事实用 \`native:memory_create\`（必要时先 \`memory_search\`）。
- 子 Agent 无记忆工具。

## 会话压缩与轮转
- 上下文过长或用户要求压缩 → \`native:session_compact\`（不换会话）；成功后只简短确认条数，勿复述摘要正文。
- 话题切换或要干净上下文 → 先写总结再 \`native:session_rotate\`。
- 长对话可 \`native:session_context_usage\` 自查；占比 ≥80% 时主动 compact 或 rotate。
- \`session_rotate\` 的 \`firstMessage\` 可指定新会话首条用户气泡（右侧，source=user）；\`focusNewSession=true\` 让前端聚焦新会话。

## 知识库与花园
- 新建花园：\`native:garden_create\`（id+title+首页）→ \`content/{id}/_garden.md\`。
- 列表/详情/改首页：\`garden_list\` / \`garden_get\` / \`garden_update\`；空库可 \`garden_delete\`（种子 posts/knowledge/resources 不可删）。
- 写文章：\`native:post_create\` / \`post_update\`（garden 须已存在，默认 posts）；列文章 \`post_list\`。
- **禁止** \`write_file\` 直写 \`content/\`（除 uploads）。

## 子 Agent
- \`spawn_subagent\`（\`waitForResult=false\`）后应立即结束当前轮，告知已派子 Agent 即可。
- 结果经 \`agent_report_back\` 自动进本会话异步结果队列，下一轮出气泡。
- **切勿**轮询 \`async_task_status\` 看子 Agent；该工具只查你主动发起的 \`async_task_run\` 纯工具任务。

## 邮件
- 需要用户回答/决策/确认 → \`native:ask_user\`（channel=ui 弹框；channel=email 可回复邮件并挂起；答复回填 customResponse，不产生独立 user 气泡）。
- 单向告知（完成/通知/告警）→ \`native:send_email\`（默认收件人见 EMAIL_TO）。
- 不要用 send_email 发需回复内容；不要用 ask_user 发单向通知；同一问题不要重复 ask_user。

## 代码呈现
- 用户要「HTML 页面/小游戏/可视化/可交互 demo」等可预览内容时：在回复里用 **html / svg 围栏代码块** 输出完整代码（前端有代码/预览切换），**不要** \`write_file\`。
- 仅当用户明确要保存到知识库/创建文件时才用 \`write_file\` 或 \`post_create\`。
- \`write_file\` 默认落当前 Agent Workspace（如 \`demo.html\` → \`workspaces/{当前workspace}/demo.html\`）；\`content/\` 开头才走知识库。

## 视频
- bilibili 链接要逐字稿/草稿 → \`native:video_transcript\`，再生成草稿或 \`post_create\`。

## 平台登录态（铁律）
- 用户说登录/重新登录/访问需登录内容（知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀等）时：**直接** \`native:platform_login\` 弹浏览器——唯一入口；登录态落盘后 \`read_article\` 复用 cookie。
- **禁止**用 \`browser_screenshot\` / \`read_image\` / \`vision_describe\` 截图检查登录态。
- 查登录态用 \`native:browser_login_status\`（返 storageState / cookie 条数，不弹窗）。`;

const OUTDATED_ASSISTANT_SYSTEM_PROMPT =
  "你是 OasisMind (见微) 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。";

/** 漂移修复指引（drift 提示中引用；原一次性迁移脚本已执行并退役） */
export const ASSISTANT_MIGRATION_HINT =
  "请在 /agents 页手动对齐内置默认工具与系统提示，或删除默认 assistant 后重启，由系统按最新模板重建";

export interface ResolveAgentResult {
  agent: AgentEntity;
  /** 默认 assistant 的配置漂移描述（空数组 = 无漂移）；指定 agentId 时恒为空 */
  drift: string[];
}

/**
 * 检测默认 assistant 相对内置默认配置的漂移（只读，不写库）。
 * 修复指引见 ASSISTANT_MIGRATION_HINT。
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
  } else if (
    (agent.systemPrompt.startsWith("你是 KnowPilot 智能助手") || agent.systemPrompt.startsWith("你是 OasisMind (见微) 智能助手")) &&
    !agent.systemPrompt.includes("garden_create")
  ) {
    // 仍是内置默认身份、但缺动态花园指引（功能新增后未跑迁移）
    drift.push("系统提示缺少动态花园指引（需升级默认提示）");
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

/** 查找 Assistant Home workspaceId（启动后应已由 initSwarm 创建） */
async function findAssistantHomeId(services: ServiceContainer): Promise<string | undefined> {
  const list = await services.workspace.list({ page: 1, pageSize: 100, status: "active" });
  const home = list.items.find(
    (w: { isSystem?: boolean; systemType?: string | null }) =>
      w.isSystem && w.systemType === ASSISTANT_HOME_SYSTEM_TYPE,
  );
  return home?.id;
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

  const homeId = await findAssistantHomeId(services);
  const created = await services.agent.create({
    name: "assistant",
    description: "OasisMind 默认助手",
    model: getAppConfig().llm.defaultModel,
    systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    tools: ASSISTANT_DEFAULT_TOOLS,
    tier: "manager",
    ...(homeId ? { workspaceId: homeId } : {}),
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
