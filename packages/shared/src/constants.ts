/**
 * @knowpilot/shared — 共享常量定义
 *
 * 统一前端和后端的事件名、实体名和系统错误码。
 */

/** 实体名称 */
export const ENTITIES = {
  POST: "post",
  AGENT: "agent",
  SKILL: "skill",
  MCP: "mcp",
  MEMORY: "memory",
  SESSION: "session",
  MESSAGE: "message",
  FILE: "file",
  LOG: "log",
  GIT: "git",
  TASK: "task",
  WORKSPACE: "workspace",
  TRIGGER: "trigger",
  APPROVAL: "approval",
  TOOL: "tool",
  RUN: "run",
  PROMPT: "prompt",
  CREDENTIAL: "credential",
} as const;

export type EntityName = typeof ENTITIES[keyof typeof ENTITIES];

/** 事件操作类型 */
export const EVENT_ACTIONS = {
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
} as const;

export type EventAction = typeof EVENT_ACTIONS[keyof typeof EVENT_ACTIONS];

/** AI-first 业务错误码 */
export const ERROR_CODES = {
  // 通用错误
  NOT_FOUND: "RECORD_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "RECORD_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  
  // 实体冲突与限制
  DUPLICATE_NAME: "DUPLICATE_NAME",
  DUPLICATE_PATH: "DUPLICATE_PATH",
  SLUG_CONFLICT: "SLUG_CONFLICT",
  
  // 文件与上传
  FILE_UPLOAD_FAILED: "FILE_UPLOAD_FAILED",
  PATH_TRAVERSAL_DETECTED: "PATH_TRAVERSAL_DETECTED",
  
  // AI 与 执行
  AI_CALL_FAILED: "AI_CALL_FAILED",
  AI_TOOL_NOT_FOUND: "AI_TOOL_NOT_FOUND",
  
  // 自动化
  TRIGGER_FAILED: "TRIGGER_FAILED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/** Chat 可选模型（前端设置面板 + Agent 默认模型） */
export interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  supportsReasoning?: boolean;
  reasoningRequired?: boolean;
  defaultTemperature?: number;
}

export const CHAT_MODELS: ChatModelOption[] = [
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "deepseek", defaultTemperature: 0.7 },
  {
    id: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    provider: "deepseek",
    supportsReasoning: true,
    reasoningRequired: true,
    defaultTemperature: 0.7,
  },
  { id: "moonshot-v1-auto", label: "Kimi Auto", provider: "kimi", supportsReasoning: true, defaultTemperature: 0.6 },
  { id: "glm-4-flash", label: "GLM-4 Flash", provider: "zhipu", defaultTemperature: 0.7 },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", defaultTemperature: 0.7 },
];
