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
  INFO_SOURCE: "infoSource",
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

/** Chat 可选模型（对齐 DeepSeek V4 API：https://api-docs.deepseek.com/guides/thinking_mode） */
export interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  /** 支持 thinking.type enabled/disabled */
  supportsThinking?: boolean;
  /** @deprecated 使用 supportsThinking + enableReasoning */
  supportsReasoning?: boolean;
  /** 旧版 reasoner：强制思考模式 */
  reasoningRequired?: boolean;
  defaultTemperature?: number;
  /** 是否原生多模态（可直接传图） */
  supportsVision?: boolean;
  /** 非多模态时是否对图片走 OCR 后拼进文本 */
  ocrFallback?: boolean;
  /** 输入能力说明（展示在 Chat 输入框下方） */
  inputHint?: string;
}

export const CHAT_MODELS: ChatModelOption[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    supportsThinking: true,
    supportsReasoning: true,
    supportsVision: false,
    ocrFallback: true,
    inputHint: "纯文本模型 · 图片将 OCR 识别后以文字附在消息中发送",
    defaultTemperature: 0.7,
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    supportsThinking: true,
    supportsReasoning: true,
    supportsVision: false,
    ocrFallback: true,
    inputHint: "纯文本模型 · 图片将 OCR 识别后以文字附在消息中发送",
    defaultTemperature: 0.7,
  },
  {
    id: "deepseek-vl2",
    label: "DeepSeek VL2（识图）",
    provider: "deepseek",
    supportsThinking: false,
    supportsVision: true,
    ocrFallback: false,
    inputHint: "多模态识图 · 支持直接发送图片（JPEG/PNG/WebP）",
    defaultTemperature: 0.7,
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat（旧 ID → V4 Flash 非思考）",
    provider: "deepseek",
    supportsThinking: true,
    supportsReasoning: true,
    defaultTemperature: 0.7,
  },
  {
    id: "deepseek-reasoner",
    label: "DeepSeek Reasoner（旧 ID → V4 Flash 思考）",
    provider: "deepseek",
    supportsThinking: true,
    supportsReasoning: true,
    reasoningRequired: true,
    defaultTemperature: 0.7,
  },
  { id: "moonshot-v1-auto", label: "Kimi Auto", provider: "kimi", supportsReasoning: true, supportsVision: true, inputHint: "多模态 · 支持图片与文本", defaultTemperature: 0.6 },
  {
    id: "kimi",
    label: "Kimi",
    provider: "kimi",
    supportsVision: true,
    inputHint: "多模态 · 支持图片与文本",
    defaultTemperature: 0.6,
  },
  { id: "glm-4-flash", label: "GLM-4 Flash", provider: "zhipu", supportsVision: true, inputHint: "多模态 · 支持图片与文本", defaultTemperature: 0.7 },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", supportsVision: true, inputHint: "多模态 · 支持图片与文本", defaultTemperature: 0.7 },
];

/** Chat 设置面板可选模型（V4 Flash / Pro / VL2 + Kimi） */
export const PRIMARY_CHAT_MODEL_IDS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-vl2",
  "kimi",
] as const;

export const PRIMARY_CHAT_MODELS: ChatModelOption[] = PRIMARY_CHAT_MODEL_IDS.map(
  (id) => CHAT_MODELS.find((m) => m.id === id)!,
);

/** 判断模型是否支持 vision 直传（与前端 getModelOption 逻辑对齐） */
export function resolveModelSupportsVision(modelId: string): boolean {
  const found = CHAT_MODELS.find((m) => m.id === modelId);
  if (found?.supportsVision) return true;
  const lower = modelId.toLowerCase();
  return (
    lower.includes("vl") ||
    lower.includes("vision") ||
    lower.includes("4o") ||
    lower.includes("glm-4")
  );
}
