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
});

export const updateSkillSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  code: z.string().optional(),
  icon: z.string().optional(),
  trigger: z.string().optional(),
  enabled: z.boolean().optional(),
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
  model: z.string().default("deepseek-chat"),
  systemPrompt: z.string().optional(),
});

export const updateSessionSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
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
  toolCalls: z.any().optional(),
  toolResults: z.any().optional(),
  tokenUsage: z.object({
    prompt: z.number(),
    completion: z.number(),
    total: z.number(),
  }).optional(),
});

export const updateMessageSchema = z.object({
  id: z.string().cuid(),
  content: z.string().min(1).optional(),
  toolCalls: z.any().optional(),
  toolResults: z.any().optional(),
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

export const listLogsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
  level: z.string().optional(),
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
   GitRepo (Git 仓库)
   ═══════════════════════════════════════════════════════ */

export const createGitRepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().default("main"),
  remoteUrl: z.string().url().optional().nullable(),
});

export const updateGitRepoSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
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
  input: z.any().optional(),
  cronExpression: z.string().optional(),
});

export const updateTaskSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).optional(),
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  output: z.any().optional(),
  cronExpression: z.string().optional(),
});

export const listTasksSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  keyword: z.string().optional(),
});

/* ═══════════════════════════════════════════════════════
   Workspace (工作区)
   ═══════════════════════════════════════════════════════ */

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  description: z.string().optional(),
  path: z.string().min(1, "路径不能为空"),
});

export const updateWorkspaceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  path: z.string().min(1).optional(),
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
  status: z.string().optional(),
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
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
export type ListFilesInput = z.infer<typeof listFilesSchema>;

export type CreateLogInput = z.infer<typeof createLogSchema>;
export type ListLogsInput = z.infer<typeof listLogsSchema>;

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
export type ListMcpServersInput = z.infer<typeof listMcpServersSchema>;

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;

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

