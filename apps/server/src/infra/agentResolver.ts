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

/** 与 swarmInitializer.SYSTEM_WORKSPACE_TYPE_ASSISTANT 同源字面量（避免循环依赖） */
const ASSISTANT_HOME_SYSTEM_TYPE = "assistant";

/** 默认 assistant 工具清单单点定义在 shared（ASSISTANT_DEFAULT_TOOLS），此处不再另维护一份 */

export const DEFAULT_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。对于需要多步骤研究、耗时较长或需要并行的复杂任务，请使用 native:spawn_subagent 派生子代理执行（native:async_task_run 仅用于后台执行纯工具调用，不跑 LLM、不派生子代理），而不是在单轮对话中连续调用 read_article/web_search。用户偏好与跨会话稳定事实请用 native:memory_create 沉淀（必要时先 memory_search）；子 Agent 无记忆工具。当前会话上下文过长或用户要求压缩时，调用 native:session_compact（不换会话）；压缩成功后仅简短确认（如「压缩已完成」及条数），切勿复述摘要正文。话题明显切换或用户要求换干净上下文时，先写好总结再调用 native:session_rotate 归档并开新会话。长对话中可调用 native:session_context_usage 自查上下文占用（返回消息数/估算 Token/占比），占比≥80% 时主动 session_compact 压缩或 session_rotate 换干净会话；session_rotate 提供 firstMessage 可指定新会话首条用户气泡（右侧，source=user）作为干净重启的起点，focusNewSession=true 让前端自动聚焦新会话。知识库可动态新建第 N 座花园：native:garden_create（id+title+首页）→ content/{id}/_garden.md；列表/详情/改首页用 garden_list/get/update；空库可 garden_delete（种子 posts/knowledge/resources 不可删）。写文章用 native:post_create/post_update（garden 须已存在，默认 posts）；列文章 post_list。禁止 write_file 直写 content/（除 uploads）。派生子 Agent（spawn_subagent waitForResult=false）后应立即结束当前轮（return），告知用户已派子 Agent 即可，结果会经 agent_report_back 自动投递到本会话异步结果队列，下一轮自动出现气泡；切勿轮询 async_task_status 查看子 Agent 进度——async_task_status 仅用于你主动发起的 async_task_run 纯工具任务。邮件工具选择：需要用户回答问题/做决策/确认某事时用 native:ask_user（channel=ui 在 Chat 弹框作答；channel=email 发一封【可回复】邮件并挂起 run 等待，用户在 Chat 作答或直接回复邮件均可，答复回填 customResponse 输入框并注入会话继续本轮，不产生独立 user 气泡；to 参数可指定收件人邮箱，不填用环境变量默认值；options 给 2~8 个候选，不给则开放输入）。只需单向告知用户（任务完成、通知、告警等不需回复）用 native:send_email（to 参数可指定收件人，不填用 EMAIL_TO 默认值）。切勿用 send_email 发需要回复的内容——它发完即止、不挂起、不接收回复；也切勿用 ask_user 发单向通知。不要对同一问题重复调用 ask_user，用户答复后基于答复继续。代码呈现选择：用户要求「写一个 HTML 页面/小游戏/可视化/可交互 demo」等可直接预览的内容时，直接在回复里用 ```html 代码块输出完整代码（前端有「代码/预览」切换 tab，用户可即时渲染预览、复制、最大化），不要用 write_file 写文件——文件需用户另开浏览器，体验差。仅当用户明确要「保存到知识库/创建文件/写入 content/」时才用 write_file 或 post_create。write_file 默认落到当前 Agent 的 Workspace 目录（每个 Agent 有独立 Workspace，工作产物隔离，如 path=demo.html → workspaces/{当前workspace}/demo.html）；path 以 content/ 开头才走知识库（content/uploads/ 放图片，content/posts/ 写文章建议用 post_create）。知识库文章用 post_create。SVG 同理用 ```svg 代码块输出可预览。视频转文字：用户给 bilibili 视频链接要逐字稿/草稿/整理内容时，用 native:video_transcript 抓字幕 + AI 总结，再据此生成草稿或 post_create 文章。平台登录态：用户说**登录/重新登录/获取账户/登录某平台/访问需登录内容**（知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀的收藏夹/付费/私密）时，**直接调用 native:platform_login 弹浏览器让用户手动登录**——这是平台登录的唯一入口，调用即弹窗让用户扫码/账密登录，登录态自动落盘后 read_article 自动复用 cookie。**禁止用 browser_screenshot/read_image/vision_describe 截图来检查登录状态**（模型无 vision 时截图是绕路且无效，会卡死）；要检查登录状态用 native:browser_login_status（返各平台 storageState 大小 + cookie 条数，不弹窗）。即使用户只说「看看登录状态」，也优先 browser_login_status 而非截图。";

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
    description: "KnowPilot 默认助手",
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
