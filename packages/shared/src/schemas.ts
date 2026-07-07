/**
 * @knowpilot/shared — 前后端共享 Zod Schema
 *
 * 所有 tRPC 输入验证的 schema 定义在这里，
 * 前端和后端共用同一份类型定义。
 */

import { z } from "zod";

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

export const createAgentSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().optional(),
  model: z.string().default("deepseek-chat"),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]), // 前端用数组，后端转逗号分隔
});

export const updateAgentSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const listAgentsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
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
  })
  .refine(
    (data) =>
      data.regenerate ||
      data.retryFromMessageId ||
      data.editMessageId ||
      (typeof data.message === "string" && data.message.trim().length > 0) ||
      (Array.isArray(data.attachments) && data.attachments.length > 0),
    { message: "需要提供 message / 附件，或使用 regenerate / edit / retry" },
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

export const createSessionSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  model: z.string().default("deepseek-v4-flash"),
  systemPrompt: z.string().optional(),
  agentId: z.string().cuid().optional(),
});

export const updateSessionSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().cuid().optional(),
});

export const listSessionsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
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

export const createMcpServerSchema = z.object({
  name: z.string().min(1).max(100),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

export const updateMcpServerSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const listMcpServersSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Memory (长期记忆)
   ═══════════════════════════════════════════════════════ */

export const createMemorySchema = z.object({
  content: z.string().min(1),
  type: z.string().default("episodic"),
  strength: z.number().min(0).max(1).default(1.0),
  keywords: z.array(z.string()).default([]),
});

export const updateMemorySchema = z.object({
  id: z.string().cuid(),
  content: z.string().min(1).optional(),
  type: z.string().optional(),
  strength: z.number().min(0).max(1).optional(),
  keywords: z.array(z.string()).optional(),
});

export const listMemoriesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  type: z.string().optional(),
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
  type: z.enum(["cron", "oneshot"]),
  status: z.enum(["pending", "running", "success", "failed"]).default("pending"),
  sessionId: z.string().nullish(),
  input: z.any().optional(),
  output: z.any().optional(),
  cronExpression: z.string().optional(),
});

export const updateTaskSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  sessionId: z.string().nullish(),
  input: z.any().optional(),
  output: z.any().optional(),
  cronExpression: z.string().optional(),
});

export const listTasksSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Workspace (工作区)
   ═══════════════════════════════════════════════════════ */

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().optional(),
  path: safePathString,
});

export const updateWorkspaceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  path: safePathString.optional(),
});

export const listWorkspacesSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
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
  status: z.enum(["pending", "approved", "rejected"]),
});

export const listApprovalsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
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
  status: z.enum(["pending", "running", "success", "failed", "cancelled"]).default("pending"),
  input: z.any().optional(),
  output: z.any().optional(),
  toolCalls: z.any().optional(),
  tokenUsage: z.any().optional(),
  error: z.any().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const updateRunSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled"]).optional(),
  output: z.any().optional(),
  toolCalls: z.any().optional(),
  tokenUsage: z.any().optional(),
  error: z.any().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const listRunsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled"]).optional(),
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

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;

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

