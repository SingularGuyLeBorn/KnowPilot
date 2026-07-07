/**
 * @knowpilot/shared — 共享实体类型
 *
 * 为前端和 AI 提供纯 TypeScript 实体类型定义，
 * 隔离数据库（Prisma）独有的私有字段，保持前后端纯净的数据交互。
 */

/** 文章实体 */
export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  coverImage: string | null;
  published: boolean;
  category: string | null;
  tags: string[]; // 前端为解析后的数组
  viewCount: number;
  metadata: any;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** AI Agent 实体 */
export interface Agent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  tools: string[]; // 解析后的工具数组
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 技能实体 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  code: string;
  icon: string | null;
  trigger: string | null;
  enabled: boolean;
  metaJson?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** MCP 服务器实体 */
export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 长期记忆实体 */
export interface Memory {
  id: string;
  content: string;
  type: string;
  strength: number;
  keywords: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 信息源实体 — Agent 可信信息来源 */
export interface InfoSource {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string;
  reliability: number;
  language: string;
  tags: string[];
  enabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** DeepSeek V4 思考强度（API 仅 high/max 生效，low/medium 映射为 high） */
export type ReasoningEffort = "low" | "medium" | "high" | "max";

/** 会话级 Chat 配置（扩展字段存 localStorage，model/systemPrompt 同步到 DB） */
export interface ChatSessionConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  /** 思考模式开关（V4：对应 API thinking.type enabled/disabled） */
  enableReasoning: boolean;
  reasoningEffort: ReasoningEffort;
  customSystemPrompt: boolean;
}

/** 会话实体 */
export interface ChatSession {
  id: string;
  title: string;
  model: string;
  systemPrompt: string | null;
  agentId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  messages?: ChatMessage[];
}

/** Chat 图片附件 */
export interface ChatImageAttachment {
  name: string;
  mimeType: string;
  previewUrl: string;
  extractedText?: string;
  source?: "ocr" | "vision" | "user";
}

/** 消息实体 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  attachments?: ChatImageAttachment[];
  toolCalls: any;
  toolResults: any;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  } | null;
  finishReason?: string | null;
  createdAt: string | Date;
}

/** 上传文件实体 */
export interface FileMeta {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string | Date;
}

/** Git 仓库实体 */
export interface GitRepo {
  id: string;
  name: string;
  path: string;
  branch: string;
  remoteUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 后台任务实体 */
export interface Task {
  id: string;
  name: string;
  type: "cron" | "oneshot";
  status: "pending" | "running" | "success" | "failed";
  sessionId: string | null;
  input: any;
  output: any;
  delivered: boolean;
  deliveredAt: string | Date | null;
  cronExpression: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 工作区实体 */
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  path: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 触发器实体 */
export interface Trigger {
  id: string;
  name: string;
  type: "file_change" | "webhook" | "cron";
  source: string;
  actionType: "run_agent" | "run_task";
  actionId: string;
  enabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 审批队列实体 */
export interface Approval {
  id: string;
  toolName: string;
  args: any;
  status: "pending" | "approved" | "rejected";
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 工具实体 */
export interface Tool {
  id: string;
  name: string;
  type: "skill" | "mcp" | "native";
  targetId: string | null;
  description: string | null;
  parametersSchema: string | null;
  enabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Agent 执行记录 */
export interface Run {
  id: string;
  agentId: string | null;
  sessionId: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  input?: unknown;
  output?: unknown;
  toolCalls?: unknown;
  tokenUsage?: unknown;
  error?: unknown;
  durationMs: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 提示词模板实体 */
export interface Prompt {
  id: string;
  name: string;
  version: string;
  description: string | null;
  variables: string[];
  tags: string[];
  content: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 凭据实体 */
export interface Credential {
  id: string;
  name: string;
  type: "api_key" | "token" | "password";
  /** 遮蔽后的预览串（首 4 + 末 4，中间 ••••）。API 永不返回明文。 */
  valuePreview: string;
  scope: string[];
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** About Me 页面 profile（来源 content/about/profile.md） */
export interface AboutProfile {
  name: string;
  title: string;
  tagline: string;
  location: string;
  github: string;
  site: string;
  email: string;
  focus: string[];
  stack: string[];
  projects: Array<{ name: string; description: string; href?: string }>;
  philosophy: string[];
  bodyMarkdown: string;
}
