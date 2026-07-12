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

/* ─── Memory 类型（对齐 Claude Code / OpenClaw 分层，experience 仅内部） ─── */

export const MEMORY_TYPES = {
  PREFERENCE: "preference",
  SEMANTIC: "semantic",
  EPISODIC: "episodic",
  NOTE: "note",
  PROCEDURAL: "procedural",
  EXPERIENCE: "experience",
} as const;

export type MemoryType = (typeof MEMORY_TYPES)[keyof typeof MEMORY_TYPES];

/** Agent / 用户可创建的 Memory 类型 */
export const MEMORY_USER_CREATABLE_TYPES = [
  MEMORY_TYPES.PREFERENCE,
  MEMORY_TYPES.SEMANTIC,
  MEMORY_TYPES.EPISODIC,
  MEMORY_TYPES.NOTE,
  MEMORY_TYPES.PROCEDURAL,
] as const;

export type MemoryUserCreatableType = (typeof MEMORY_USER_CREATABLE_TYPES)[number];

/** 可注入 Chat system prompt 的类型（排除 experience） */
export const MEMORY_INJECTABLE_TYPES = [...MEMORY_USER_CREATABLE_TYPES] as const;

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  preference: "用户偏好",
  semantic: "稳定事实",
  episodic: "经历事件",
  note: "笔记",
  procedural: "操作流程",
  experience: "运行经验（内部）",
};

/** Auto-Compact 默认：占模型 context window 的触发比例 */
export const DEFAULT_COMPACT_TRIGGER_RATIO = 0.75;
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_COMPACT_KEEP_RECENT = 8;
export const DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS = 4_000;

/** Chat 可选模型（对齐 DeepSeek V4 API：https://api-docs.deepseek.com/guides/thinking_mode） */
export interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  /** 模型上下文窗口（token），用于 Auto-Compact 动态阈值 */
  contextWindowTokens?: number;
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
    contextWindowTokens: 128_000,
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
    contextWindowTokens: 128_000,
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
    contextWindowTokens: 64_000,
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

/** 解析模型 context window（token），用于 Auto-Compact 百分比阈值 */
export function resolveModelContextWindowTokens(modelId: string): number {
  const found = CHAT_MODELS.find((m) => m.id === modelId);
  if (found?.contextWindowTokens) return found.contextWindowTokens;
  const lower = modelId.toLowerCase();
  if (lower.includes("200k") || lower.includes("128k")) return 128_000;
  if (lower.includes("64k")) return 64_000;
  if (lower.includes("32k")) return 32_000;
  if (lower.includes("16k")) return 16_000;
  if (lower.includes("8k")) return 8_000;
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}

/** 字符 ≈ token×4 粗算，得到 Auto-Compact 触发字符阈值 */
export function resolveCompactCharThreshold(
  modelId: string,
  triggerRatio = DEFAULT_COMPACT_TRIGGER_RATIO,
): number {
  const ratio = Math.min(0.95, Math.max(0.05, triggerRatio));
  const windowTokens = resolveModelContextWindowTokens(modelId);
  return Math.max(8_000, Math.floor(windowTokens * ratio * 4));
}

export function isMemoryInjectable(type: string): boolean {
  return (MEMORY_INJECTABLE_TYPES as readonly string[]).includes(type);
}

export function isMemoryUserCreatable(type: string): boolean {
  return (MEMORY_USER_CREATABLE_TYPES as readonly string[]).includes(type);
}
