/**
 * @knowpilot/shared — 前后端共享 Zod Schema
 *
 * 所有 tRPC 输入验证的 schema 定义在这里，
 * 前端和后端共用同一份类型定义。
 */

import { z } from "zod";
import {
  AGENT_TIERS,
  DEFAULT_LLM_MODEL,
  LLM_MODEL_IDS,
  MEMORY_INITIAL_STRENGTH,
  MEMORY_USER_CREATABLE_TYPES,
} from "./constants";

/* ═══════════════════════════════════════════════════════
   Post (文章)
   ═══════════════════════════════════════════════════════ */

export const createPostSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  content: z.string().default(""),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  coverImage: z.string().url().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  published: z.boolean().optional(),
});

export const updatePostSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  slug: z.string().optional(),
  published: z.boolean().optional(),
  excerpt: z.string().optional(),
  coverImage: z.string().url().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

export const listPostsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  published: z.boolean().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  keyword: z.string().optional(),
  orderBy: z.enum(["createdAt", "updatedAt", "title"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const searchPostsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

/* ═══════════════════════════════════════════════════════
   Agent (AI 代理)
   ═══════════════════════════════════════════════════════ */

export const agentTierSchema = z.enum(AGENT_TIERS);
export const agentStatusSchema = z.enum(["active", "idle", "dormant", "deleted"]);
export const workspaceStatusSchema = z.enum(["active", "archived", "deleted"]);

export const loopContractEvidenceSchema = z.object({
  at: z.string(),
  summary: z.string(),
  fingerprint: z.string(),
  taskId: z.string().optional(),
  status: z.enum(["success", "failed", "cancelled", "budget_exceeded", "skipped"]),
});

export const loopContractSchema = z.object({
  goal: z.string().default(""),
  handoff: z.boolean().default(true),
  gateOpen: z.boolean().default(true),
  evidence: z.array(loopContractEvidenceSchema).default([]),
  stopRule: z.object({ maxStaleRounds: z.number().int().min(1).default(3) }).default({ maxStaleRounds: 3 }),
  staleRounds: z.number().int().min(0).default(0),
  stoppedReason: z.string().nullable().default(null),
});

export const heartbeatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  cron: z.string().default("0 9 * * *"),
  goal: z.string().default(""),
  lastRunAt: z.string().nullable().optional(),
  lastRunStatus: z.string().nullable().optional(),
  consecutiveFailures: z.number().default(0),
  /** LoopX 式控制平面（Phase 1：超级 Agent 心跳） */
  loopContract: loopContractSchema.optional(),
});

export const createAgentSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().optional(),
  model: z.string().default(LLM_MODEL_IDS.DEEPSEEK_CHAT),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]),
  // Swarm 层级（不传则 service 层默认 "sub"）
  tier: agentTierSchema.optional(),
  workspaceId: z.string().cuid().optional(),
  parentId: z.string().cuid().optional(),
  source: z.string().max(64).optional(),
  apiKey: z.string().optional(),
  heartbeatModel: z.string().optional(),
  heartbeat: heartbeatConfigSchema.optional(),
});

export const updateAgentSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  // Swarm
  tier: agentTierSchema.optional(),
  workspaceId: z.string().cuid().nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  source: z.string().max(64).nullable().optional(),
  apiKey: z.string().nullable().optional(),
  heartbeatModel: z.string().nullable().optional(),
  heartbeat: heartbeatConfigSchema.optional(),
  status: agentStatusSchema.optional(),
});

export const listAgentsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  // Swarm 过滤
  tier: agentTierSchema.optional(),
  workspaceId: z.string().cuid().optional(),
  parentId: z.string().cuid().optional(),
  status: agentStatusSchema.optional(),
});

export const agentRunSchema = z.object({
  agentId: z.string().cuid().optional(),
  sessionId: z.string().cuid().optional(),
  input: z.string().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .optional(),
});

export const chatConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(32768).optional(),
  systemPrompt: z.string().optional(),
  enableReasoning: z.boolean().optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "max"]).optional(),
  toolCallTimeoutMs: z.number().int().min(2000).max(600000).optional(),
  maxToolRounds: z.number().int().min(1).max(50).optional(),
});

export const switchMessageVersionSchema = z.object({
  messageId: z.string().cuid(),
  versionIndex: z.number().int().min(0),
});

/** Chat 图片附件 — vision 模型直传 data URL，非 vision 走 OCR 文本 */
export const chatImageAttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  previewUrl: z.string(),
  extractedText: z.string().optional(),
  source: z.enum(["ocr", "vision", "user"]).optional(),
});

export const agentChatSchema = z
  .object({
    sessionId: z.string().cuid().optional(),
    agentId: z.string().cuid().optional(),
    message: z.string().min(1).optional(),
    attachments: z.array(chatImageAttachmentSchema).optional(),
    model: z.string().optional(),
    config: chatConfigSchema.optional(),
    regenerate: z.boolean().optional(),
    regenerateUserMessageId: z.string().cuid().optional(),
    retryFromMessageId: z.string().cuid().optional(),
    editMessageId: z.string().cuid().optional(),
    editContent: z.string().min(1).optional(),
    skillId: z.string().cuid().optional(),
    source: z.enum(["user", "super", "manager", "sub", "system"]).optional(),
    /** 工具权限血统：parent=上级任务/异步续跑（允许 report_back）；user=用户直接对话 */
    runOrigin: z.enum(["user", "parent", "heartbeat"]).optional(),
    toolResults: z.record(z.unknown()).optional(),
    clientMessageId: z.string().optional(),
    resumeAfter: z.number().int().min(0).optional(),
  })
  .refine(
    (data) =>
      data.regenerate ||
      data.retryFromMessageId ||
      data.editMessageId ||
      data.resumeAfter !== undefined ||
      (typeof data.message === "string" && data.message.trim().length > 0) ||
      (Array.isArray(data.attachments) && data.attachments.length > 0),
    { message: "需要提供 message / 附件，或使用 regenerate / edit / retry / resumeAfter" },
  )
  .refine(
    (data) => !data.editMessageId || (typeof data.editContent === "string" && data.editContent.trim().length > 0),
    { message: "编辑消息需要提供 editContent" },
  );

export const webSearchSchema = z.object({
  query: z.string().min(1, "搜索词不能为空"),
  maxResults: z.number().int().min(1).max(20).default(5),
  provider: z.enum(["auto", "tavily", "serpapi"]).default("auto"),
});

export const gitRepoPathSchema = z.object({
  repoId: z.string().cuid().optional(),
  repoPath: z.string().optional(),
});

export const gitLogSchema = gitRepoPathSchema.extend({
  limit: z.number().int().min(1).max(100).default(10),
});

export const gitDiffSchema = gitRepoPathSchema.extend({
  staged: z.boolean().default(false),
});

export const gitCommitSchema = gitRepoPathSchema.extend({
  message: z.string().min(1, "提交信息不能为空"),
});

export const nativeExecuteSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.any()).default({}),
});

/* ═══════════════════════════════════════════════════════
   Skill (技能 / 工具)
   ═══════════════════════════════════════════════════════ */

export const createSkillSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().min(1, "描述不能为空"),
  code: z.string().min(1, "代码实现不能为空"),
  icon: z.string().optional(),
  trigger: z.string().optional(),
  enabled: z.boolean().default(true),
  metaJson: z.string().optional(),
});

export const updateSkillSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  code: z.string().optional(),
  icon: z.string().optional(),
  trigger: z.string().optional(),
  enabled: z.boolean().optional(),
  metaJson: z.string().optional(),
});

export const listSkillsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  enabled: z.boolean().optional(),
});

/* ═══════════════════════════════════════════════════════
   Session (会话)
   ═══════════════════════════════════════════════════════ */

export const sessionStatusSchema = z.enum(["active", "queued", "running", "paused", "completed", "failed", "archived"]);

export const sessionKindSchema = z.enum(["chat", "subagent", "heartbeat", "skill_review"]);

export const sessionGoalModeSchema = z.enum(["goal", "deep_research"]);
export const sessionGoalStatusSchema = z.enum(["active", "paused", "done", "exhausted"]);

export const sessionGoalStateSchema = z.object({
  mode: sessionGoalModeSchema,
  text: z.string().min(1).max(8000),
  status: sessionGoalStatusSchema,
  turnsUsed: z.number().int().min(0).default(0),
  maxTurns: z.number().int().min(1).max(200),
  judgeModel: z.string().default("auto"),
  execModel: z.string().optional(),
  lastVerdict: z
    .object({
      done: z.boolean(),
      reason: z.string(),
    })
    .optional(),
  /** 本轮 done 后待 settled 钩子续跑（架构事件，非定时器） */
  pendingContinue: z
    .object({
      reason: z.string(),
    })
    .nullable()
    .optional(),
});

export type SessionGoalState = z.infer<typeof sessionGoalStateSchema>;

export const createSessionSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  model: z.string().default(DEFAULT_LLM_MODEL),
  systemPrompt: z.string().optional(),
  agentId: z.string().cuid().optional(),
  // Swarm/Subagent
  parentSessionId: z.string().cuid().optional(),
  kind: sessionKindSchema.optional(),
  taskDescription: z.string().max(2000).optional(),
  status: sessionStatusSchema.optional(),
  isMainSession: z.boolean().optional(), // 管理 Agent 的主 session
  goalState: sessionGoalStateSchema.nullable().optional(),
});

export const updateSessionSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  autoName: z.string().max(200).nullable().optional(), // 手动重命名写此字段，显示优先于 title
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().cuid().optional(),
  // Swarm/Subagent
  status: sessionStatusSchema.optional(),
  taskDescription: z.string().max(2000).optional(),
  kind: sessionKindSchema.optional(),
  parentSessionId: z.string().cuid().nullable().optional(),
  // Auto-Compact 持久化摘要
  contextSummary: z.string().max(20000).nullable().optional(),
  contextCompactedAt: z.coerce.date().nullable().optional(),
  rotatedToSessionId: z.string().cuid().nullable().optional(),
  goalState: sessionGoalStateSchema.nullable().optional(),
});

export const setSessionGoalSchema = z.object({
  sessionId: z.string().cuid(),
  text: z.string().min(1).max(8000),
  mode: sessionGoalModeSchema.default("goal"),
  maxTurns: z.number().int().min(1).max(200).optional(),
  judgeModel: z.string().optional(),
  execModel: z.string().optional(),
  /** 设置后是否立刻以 goal 文本起第一轮（默认 true） */
  startNow: z.boolean().default(true),
});

export const sessionGoalControlSchema = z.object({
  sessionId: z.string().cuid(),
});

export const listSideRunsSchema = z.object({
  parentSessionId: z.string().cuid(),
  pageSize: z.number().int().min(1).max(100).default(30),
});

export const compactSessionSchema = z.object({
  id: z.string().cuid(),
});

export const listSessionsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  // 按 agentId 批量过滤（WorkspaceTree 用）：非空时不分页、服务端 take 上限 500
  agentIds: z.array(z.string()).optional(),
  // Swarm/Subagent 过滤
  parentSessionId: z.string().cuid().optional(),
  kind: sessionKindSchema.optional(),
  status: sessionStatusSchema.optional(),
});

export const stopSessionSchema = z.object({ id: z.string().cuid() });

export const rerunSessionSchema = z.object({
  id: z.string().cuid(),
  taskDescription: z.string().max(2000).optional(),
});

// C-3 会话手动恢复（v10）：仅恢复 paused 会话，幂等（并发/重复调用不报错）
export const resumeSessionSchema = z.object({ id: z.string().cuid() });

/** 确保 Agent 有一条主会话（空会话亦可）；Chat 无焦点进入时用，幂等。与「新对话」无关 */
export const ensureMainSessionSchema = z.object({
  agentId: z.string().cuid(),
});

/**
 * 「新对话」：有空会话则复用（或提示已在其上），否则新建空会话。
 * focusedSessionId 用于判定 already_here。
 */
export const openNewSessionSchema = z.object({
  agentId: z.string().cuid(),
  focusedSessionId: z.string().cuid().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Message (消息)
   ═══════════════════════════════════════════════════════ */

export const createMessageSchema = z.object({
  sessionId: z.string().cuid(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().min(1, "内容不能为空"),
  attachments: z.array(chatImageAttachmentSchema).optional(),
  toolCalls: z.any().optional(),
  toolResults: z.any().optional(),
  tokenUsage: z.object({
    prompt: z.number(),
    completion: z.number(),
    total: z.number(),
  }).optional(),
  finishReason: z.string().optional(),
  source: z.enum(["user", "super", "manager", "sub", "system"]).optional(), // 不传则 service 层默认 "user"
});

export const updateMessageSchema = z.object({
  id: z.string().cuid(),
  content: z.string().min(1).optional(),
  attachments: z.array(chatImageAttachmentSchema).optional(),
  toolCalls: z.any().optional(),
  toolResults: z.any().optional(),
  finishReason: z.string().optional(),
});

export const listMessagesSchema = z.object({
  sessionId: z.string().cuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

// P0-1：Chat 专用 cursor 无限查询（session 元数据与消息解耦）
export const listMessagesForChatSchema = z.object({
  sessionId: z.string().cuid(),
  /** cursor = 上一页最旧消息 id；省略时返最近 limit 条 */
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/* ═══════════════════════════════════════════════════════
   SessionQueueItem（会话发送队列）
   ═══════════════════════════════════════════════════════ */

export const createSessionQueueItemSchema = z.object({
  sessionId: z.string().cuid(),
  kind: z.enum(["user", "superior", "child_notify"]),
  content: z.string().min(1, "队列项内容不能为空"),
  source: z.string().min(1),
  sourceName: z.string().optional(),
  agentMessageId: z.string().cuid().optional(),
  attachments: z.any().optional(),
  skillId: z.string().optional(),
  skillPrompt: z.string().optional(),
});

/** 运行中注入 Steering / Follow-up（Pi 语义） */
export const submitAgentInjectSchema = z.object({
  sessionId: z.string().cuid(),
  content: z.string().min(1, "注入内容不能为空"),
  kind: z.enum(["steer", "follow_up"]).default("steer"),
});

export const updateSessionQueueItemSchema = z.object({
  id: z.string().cuid(),
  content: z.string().min(1).optional(),
  order: z.number().int().optional(),
  attachments: z.any().optional(),
  skillId: z.string().optional(),
  skillPrompt: z.string().optional(),
});

export const listSessionQueueItemsSchema = z.object({
  sessionId: z.string().cuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(100),
});

export const reorderSessionQueueItemsSchema = z.object({
  sessionId: z.string().cuid(),
  /** 有序的 item id 数组，按新顺序排列 */
  orderedIds: z.array(z.string().cuid()).min(1),
});

/* ═══════════════════════════════════════════════════════
   File (文件)
   ═══════════════════════════════════════════════════════ */

export const createFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string(),
  size: z.number().int().positive(),
  url: z.string(),
});

export const uploadFileSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string(),
  size: z.number().int().positive(),
  data: z.string().min(1), // base64 encoded file content
});

export const updateFileSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
});

export const listFilesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Log (日志)
   ═══════════════════════════════════════════════════════ */

export const createLogSchema = z.object({
  level: z.enum(["info", "warn", "error", "debug", "success"]),
  component: z.string(),
  event: z.string(),
  message: z.string(),
  metadata: z.any().optional(),
});

export const updateLogSchema = z.object({
  id: z.string().cuid(),
  message: z.string().min(1).optional(),
  metadata: z.any().optional(),
});

export const listLogsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  level: z.enum(["info", "warn", "error", "debug", "success"]).optional(),
  component: z.string().optional(),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   McpServer (MCP 服务)
   ═══════════════════════════════════════════════════════ */

const mcpTransportSchema = z.enum(["stdio", "http"]);

function refineMcpTransport(
  data: {
    transport?: "stdio" | "http";
    command?: string;
    url?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const transport = data.transport ?? "stdio";
  if (transport === "stdio") {
    if (!data.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stdio 传输必须填写 command",
        path: ["command"],
      });
    }
  } else if (transport === "http") {
    const url = data.url?.trim() ?? "";
    if (!url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "http 传输必须填写 url",
        path: ["url"],
      });
    } else {
      try {
        void new URL(url);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "url 不是合法 URL",
          path: ["url"],
        });
      }
    }
  }
}

export const createMcpServerSchema = z
  .object({
    name: z.string().min(1).max(100),
    transport: mcpTransportSchema.default("stdio"),
    command: z.string().default(""),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    url: z.string().optional().nullable(),
    headers: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
  })
  .superRefine(refineMcpTransport);

export const updateMcpServerSchema = z
  .object({
    id: z.string().cuid(),
    name: z.string().min(1).max(100).optional(),
    transport: mcpTransportSchema.optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional().nullable(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // 更新时仅在显式带了 transport 或同时改了 command/url 时校验；完整校验由 Service 合并后做
    if (data.transport !== undefined) refineMcpTransport(data, ctx);
  });

export const listMcpServersSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Memory (长期记忆)
   ═══════════════════════════════════════════════════════ */

export const memoryUserTypeSchema = z.enum(MEMORY_USER_CREATABLE_TYPES);

export const memoryAttributionSchema = z.enum([
  "user",
  "agent",
  "flush",
  "experience",
  "system",
]);

export const memoryStatusSchema = z.enum(["active", "superseded"]);

export const createMemorySchema = z.object({
  content: z.string().min(1),
  type: memoryUserTypeSchema.default("note"),
  strength: z.number().min(0).max(1).default(MEMORY_INITIAL_STRENGTH),
  keywords: z.array(z.string()).default([]),
  /** 事实来源归因（可选；Agent 工具 / flush 会写入） */
  attribution: memoryAttributionSchema.optional(),
  /** 作用域：global / workspace:{id} / agent:{id}；UI 创建默认 global */
  scope: z.string().max(120).optional(),
  validFrom: z.coerce.date().optional().nullable(),
  validTo: z.coerce.date().optional().nullable(),
});

export const updateMemorySchema = z.object({
  id: z.string().cuid(),
  content: z.string().min(1).optional(),
  type: memoryUserTypeSchema.optional(),
  strength: z.number().min(0).max(1).optional(),
  keywords: z.array(z.string()).optional(),
  attribution: memoryAttributionSchema.optional(),
  scope: z.string().max(120).optional(),
  validFrom: z.coerce.date().optional().nullable(),
  validTo: z.coerce.date().optional().nullable(),
  status: memoryStatusSchema.optional(),
});

export const listMemoriesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  type: z.string().optional(),
  scope: z.string().optional(),
  status: memoryStatusSchema.optional(),
});

/* ═══════════════════════════════════════════════════════
   InfoSource (信息源)
   ═══════════════════════════════════════════════════════ */

export const infoSourceTypeSchema = z.enum([
  "blog",
  "paper",
  "news",
  "official",
  "community",
  "general",
  "rss",
]);

export const infoSourceLanguageSchema = z.enum(["zh", "en", "auto"]);

export const createInfoSourceSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(200),
  url: z.string().min(1, "URL 不能为空"),
  type: infoSourceTypeSchema.default("general"),
  description: z.string().default(""),
  reliability: z.number().int().min(1).max(5).default(3),
  language: infoSourceLanguageSchema.default("auto"),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  fetchInterval: z.number().int().min(5).max(10080).optional(), /// 5 分钟 ~ 1 周
});

export const updateInfoSourceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(200).optional(),
  url: z.string().min(1).optional(),
  type: infoSourceTypeSchema.optional(),
  description: z.string().optional(),
  reliability: z.number().int().min(1).max(5).optional(),
  language: infoSourceLanguageSchema.optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  fetchInterval: z.number().int().min(5).max(10080).optional().nullable(),
});

export const listInfoSourcesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  type: infoSourceTypeSchema.optional(),
  tag: z.string().optional(),
  minReliability: z.number().int().min(1).max(5).optional(),
  enabled: z.boolean().optional(),
});

/* ═══════════════════════════════════════════════════════
   GitRepo (Git 仓库)
   ═══════════════════════════════════════════════════════ */

const safePathString = z
  .string()
  .min(1)
  .refine((v) => !v.includes("..") && /^([A-Za-z]:[\\/].*|[\\/].*|[^\\/].*)$/.test(v), {
    message: "路径不能包含 ..，且需为合法相对或绝对路径",
  });

export const createGitRepoSchema = z.object({
  name: z.string().min(1),
  path: safePathString,
  branch: z.string().default("main"),
  remoteUrl: z.string().url().optional().nullable(),
});

export const updateGitRepoSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
  path: safePathString.optional(),
  branch: z.string().optional(),
  remoteUrl: z.string().url().optional().nullable(),
});

export const listGitReposSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/* ═══════════════════════════════════════════════════════
   Task (后台任务)
   ═══════════════════════════════════════════════════════ */

export const createTaskSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["cron", "oneshot", "async_agent"]),
  status: z.enum(["pending", "queued", "running", "success", "failed", "cancelled"]).default("pending"),
  sessionId: z.string().nullish(),
  input: z.any().optional(),
  output: z.any().optional(),
  cronExpression: z.string().optional(),
  queuedAt: z.coerce.date().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  finishedAt: z.coerce.date().optional().nullable(),
});

export const updateTaskSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
  status: z.enum(["pending", "queued", "running", "success", "failed", "cancelled"]).optional(),
  sessionId: z.string().nullish(),
  input: z.any().optional(),
  output: z.any().optional(),
  cronExpression: z.string().optional(),
  queuedAt: z.coerce.date().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  finishedAt: z.coerce.date().optional().nullable(),
});

export const listTasksSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "queued", "running", "success", "failed", "cancelled"]).optional(),
  keyword: z.string().optional(),
  // R7：按会话过滤（listSessionAsyncJobs 用），避免全局拉 50 条后 JS 过滤漏掉非 top-50 任务
  sessionId: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Workspace (工作区)
   ═══════════════════════════════════════════════════════ */

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().optional(),
  path: safePathString,
  /** 是否自动创建管理 Agent（默认 true）；与 withManager 同义，任一为 false 即关闭 */
  autoCreateManager: z.boolean().optional(),
  withManager: z.boolean().optional(),
  managerName: z.string().min(1).max(100).optional(),
  /** 创建后发给管理员主会话的初始任务（无管理员时忽略） */
  initialTask: z.string().max(8000).optional(),
  /** 本 Workspace 后台 LLM 异步槽上限；0=不限；默认 2 */
  asyncSlotQuota: z.number().int().min(0).max(100).optional(),
  isSystem: z.boolean().optional(), // 系统级 Workspace（内部使用）
  systemType: z.string().optional(), // 系统 Workspace 类型，如 "super"
});

export const updateWorkspaceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  path: safePathString.optional(),
  status: workspaceStatusSchema.optional(),
  asyncSlotQuota: z.number().int().min(0).max(100).optional(),
  isSystem: z.boolean().optional(),
  systemType: z.string().optional(),
});

export const listWorkspacesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: workspaceStatusSchema.optional(),
});

/* ═══════════════════════════════════════════════════════
   Trigger (触发器)
   ═══════════════════════════════════════════════════════ */

export const createTriggerSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  type: z.enum(["file_change", "webhook", "cron"]),
  source: z.string().min(1, "触发源不能为空"),
  actionType: z.enum(["run_agent", "run_task"]),
  actionId: z.string().min(1, "动作关联ID不能为空"),
  enabled: z.boolean().default(true),
});

export const updateTriggerSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["file_change", "webhook", "cron"]).optional(),
  source: z.string().min(1).optional(),
  actionType: z.enum(["run_agent", "run_task"]).optional(),
  actionId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const listTriggersSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Approval (审批队列)
   ═══════════════════════════════════════════════════════ */

export const createApprovalSchema = z.object({
  toolName: z.string().min(1),
  args: z.any(),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
});

export const updateApprovalSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(["pending", "approved", "rejected", "executed"]),
  decisionNote: z.string().optional(),
});

export const listApprovalsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "approved", "rejected", "executed"]).optional(),
});

/* ═══════════════════════════════════════════════════════
   Tool (工具注册表)
   ═══════════════════════════════════════════════════════ */

export const createToolSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  type: z.enum(["skill", "mcp", "native"]),
  targetId: z.string().optional(),
  description: z.string().optional(),
  parametersSchema: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const updateToolSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["skill", "mcp", "native"]).optional(),
  targetId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parametersSchema: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const listToolsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  type: z.enum(["skill", "mcp", "native"]).optional(),
  keyword: z.string().optional(),
  enabled: z.boolean().optional(),
});

/* ═══════════════════════════════════════════════════════
   Run (Agent 执行记录)
   ═══════════════════════════════════════════════════════ */

export const createRunSchema = z.object({
  agentId: z.string().cuid().optional(),
  sessionId: z.string().cuid().optional(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled", "interrupted"]).default("pending"),
  input: z.any().optional(),
  output: z.any().optional(),
  toolCalls: z.any().optional(),
  tokenUsage: z.any().optional(),
  error: z.any().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
});

export const updateRunSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled", "interrupted"]).optional(),
  output: z.any().optional(),
  toolCalls: z.any().optional(),
  tokenUsage: z.any().optional(),
  error: z.any().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
});

export const listRunsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled", "interrupted"]).optional(),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Prompt (提示词模板)
   ═══════════════════════════════════════════════════════ */

export const createPromptSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  version: z.string().default("1.0.0"),
  description: z.string().optional(),
  variables: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  content: z.string().min(1, "内容不能为空"),
});

export const updatePromptSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  version: z.string().optional(),
  description: z.string().optional().nullable(),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  content: z.string().optional(),
});

export const listPromptsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  tag: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Credential (凭据)
   ═══════════════════════════════════════════════════════ */

export const createCredentialSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  type: z.enum(["api_key", "token", "password"]),
  value: z.string().min(1, "值不能为空"),
  scope: z.array(z.string()).default([]),
  lastUsedAt: z.string().datetime().optional().or(z.date().optional()),
  expiresAt: z.string().datetime().optional().or(z.date().optional()),
  metadata: z.record(z.any()).optional(),
});

export const updateCredentialSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["api_key", "token", "password"]).optional(),
  value: z.string().optional(),
  scope: z.array(z.string()).optional(),
  lastUsedAt: z.string().datetime().optional().or(z.date().optional()),
  expiresAt: z.string().datetime().optional().or(z.date().optional()),
  metadata: z.record(z.any()).optional(),
});

export const listCredentialsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  type: z.enum(["api_key", "token", "password"]).optional(),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   L4 审批 / 任务 / 工作流
   ═══════════════════════════════════════════════════════ */

export const deleteByIdSchema = z.object({
  id: z.string().cuid(),
});

export const deleteByIdWithApprovalSchema = deleteByIdSchema.extend({
  approvalId: z.string().cuid().optional(),
});

export const gitPushWithApprovalSchema = gitRepoPathSchema.extend({
  approvalId: z.string().cuid().optional(),
});

// P0-4：git.commit / git.pull 入审批，与 git.push 同档
export const gitCommitWithApprovalSchema = gitCommitSchema.extend({
  approvalId: z.string().cuid().optional(),
});
export const gitPullWithApprovalSchema = gitRepoPathSchema.extend({
  approvalId: z.string().cuid().optional(),
});

export const runTaskSchema = z.object({
  id: z.string().cuid(),
});

export const executeApprovalSchema = z.object({
  id: z.string().cuid(),
});

export const approveAndExecuteApprovalSchema = executeApprovalSchema;

export const workflowStepSchema = z.object({
  action: z.string().min(1),
  input: z.any().optional(),
});

export const runWorkflowSchema = z.object({
  name: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
});

export const globalSearchSchema = z.object({
  query: z.string().min(1, "搜索词不能为空"),
  entities: z
    .array(z.enum(["post", "agent", "skill", "memory", "task", "mcp", "message"]))
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const analyticsDashboardSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const authLoginSchema = z.object({
  password: z.string().min(1, "密码不能为空"),
});

/* ═══════════════════════════════════════════════════════
   通用类型响应包装
   ═══════════════════════════════════════════════════════ */

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });

/* ═══════════════════════════════════════════════════════
   类型导出 (从 schema 推导)
   ═══════════════════════════════════════════════════════ */

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type ListPostsInput = z.infer<typeof listPostsSchema>;
export type SearchPostsInput = z.infer<typeof searchPostsSchema>;

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type ListAgentsInput = z.infer<typeof listAgentsSchema>;
export type AgentRunInput = z.infer<typeof agentRunSchema>;
export type SwitchMessageVersionInput = z.infer<typeof switchMessageVersionSchema>;
export type ChatConfigInput = z.infer<typeof chatConfigSchema>;
export type AgentChatInput = z.infer<typeof agentChatSchema>;

export type WebSearchInput = z.infer<typeof webSearchSchema>;
export type GitRepoPathInput = z.infer<typeof gitRepoPathSchema>;
export type NativeExecuteInput = z.infer<typeof nativeExecuteSchema>;
export type DeleteByIdWithApprovalInput = z.infer<typeof deleteByIdWithApprovalSchema>;
export type GitPushWithApprovalInput = z.infer<typeof gitPushWithApprovalSchema>;
export type GitCommitWithApprovalInput = z.infer<typeof gitCommitWithApprovalSchema>;
export type GitPullWithApprovalInput = z.infer<typeof gitPullWithApprovalSchema>;
export type RunTaskInput = z.infer<typeof runTaskSchema>;
export type ExecuteApprovalInput = z.infer<typeof executeApprovalSchema>;
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
export type GlobalSearchInput = z.infer<typeof globalSearchSchema>;
export type AnalyticsDashboardInput = z.infer<typeof analyticsDashboardSchema>;
export type AuthLoginInput = z.infer<typeof authLoginSchema>;

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type ListSkillsInput = z.infer<typeof listSkillsSchema>;

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type ListSessionsInput = z.infer<typeof listSessionsSchema>;
export type StopSessionInput = z.infer<typeof stopSessionSchema>;
export type RerunSessionInput = z.infer<typeof rerunSessionSchema>;
export type ResumeSessionInput = z.infer<typeof resumeSessionSchema>;
export type EnsureMainSessionInput = z.infer<typeof ensureMainSessionSchema>;
export type OpenNewSessionInput = z.infer<typeof openNewSessionSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SetSessionGoalInput = z.infer<typeof setSessionGoalSchema>;
export type SessionGoalControlInput = z.infer<typeof sessionGoalControlSchema>;
export type ListSideRunsInput = z.infer<typeof listSideRunsSchema>;

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;

export type CreateSessionQueueItemInput = z.infer<typeof createSessionQueueItemSchema>;
export type SubmitAgentInjectInput = z.infer<typeof submitAgentInjectSchema>;
export type UpdateSessionQueueItemInput = z.infer<typeof updateSessionQueueItemSchema>;
export type ListSessionQueueItemsInput = z.infer<typeof listSessionQueueItemsSchema>;
export type ReorderSessionQueueItemsInput = z.infer<typeof reorderSessionQueueItemsSchema>;

export type CreateFileInput = z.infer<typeof createFileSchema>;
export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
export type ListFilesInput = z.infer<typeof listFilesSchema>;

export type CreateLogInput = z.infer<typeof createLogSchema>;
export type UpdateLogInput = z.infer<typeof updateLogSchema>;
export type ListLogsInput = z.infer<typeof listLogsSchema>;

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
export type ListMcpServersInput = z.infer<typeof listMcpServersSchema>;

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;

export type CreateInfoSourceInput = z.infer<typeof createInfoSourceSchema>;
export type UpdateInfoSourceInput = z.infer<typeof updateInfoSourceSchema>;
export type ListInfoSourcesInput = z.infer<typeof listInfoSourcesSchema>;

export type CreateGitRepoInput = z.infer<typeof createGitRepoSchema>;
export type UpdateGitRepoInput = z.infer<typeof updateGitRepoSchema>;
export type ListGitReposInput = z.infer<typeof listGitReposSchema>;

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type ListWorkspacesInput = z.infer<typeof listWorkspacesSchema>;

export type CreateTriggerInput = z.infer<typeof createTriggerSchema>;
export type UpdateTriggerInput = z.infer<typeof updateTriggerSchema>;
export type ListTriggersInput = z.infer<typeof listTriggersSchema>;

export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;
export type UpdateApprovalInput = z.infer<typeof updateApprovalSchema>;
export type ListApprovalsInput = z.infer<typeof listApprovalsSchema>;

export type CreateToolInput = z.infer<typeof createToolSchema>;
export type UpdateToolInput = z.infer<typeof updateToolSchema>;
export type ListToolsInput = z.infer<typeof listToolsSchema>;

export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
export type ListRunsInput = z.infer<typeof listRunsSchema>;

export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
export type ListPromptsInput = z.infer<typeof listPromptsSchema>;

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
export type ListCredentialsInput = z.infer<typeof listCredentialsSchema>;

