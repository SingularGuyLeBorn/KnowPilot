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

/** Memory scope：global 全局共享；agent:{agentId} 归属特定 Agent；workspace:{workspaceId} 归属 Workspace */
export const MEMORY_SCOPE_GLOBAL = "global";

/** scope 前缀常量（避免散落模板字符串） */
export const MEMORY_SCOPE_PREFIX = {
  AGENT: "agent:",
  WORKSPACE: "workspace:",
} as const;

export function memoryAgentScope(agentId: string): string {
  return `${MEMORY_SCOPE_PREFIX.AGENT}${agentId}`;
}

export function memoryWorkspaceScope(workspaceId: string): string {
  return `${MEMORY_SCOPE_PREFIX.WORKSPACE}${workspaceId}`;
}

/** Memory Flush 默认强度：用户偏好 / 一般事实（原 memoryFlush.ts 魔法数字收敛） */
export const MEMORY_FLUSH_STRENGTH_PREFERENCE = 0.95;
export const MEMORY_FLUSH_STRENGTH_DEFAULT = 0.85;

/** 新记忆初始强度（memoryRepository.create / createMemorySchema 默认值同源） */
export const MEMORY_INITIAL_STRENGTH = 1.0;

/**
 * L1 常驻层硬预算（Hermes 对标：USER ~500 tok / AGENT ~800 tok，按 ~4 字/token 粗估）。
 * 写入与注入均截断到此上限；会话开始冻结快照，会话内改文件不影响本会话 prompt。
 */
export const PINNED_MEMORY_USER_MAX_CHARS = 2_000;
export const PINNED_MEMORY_AGENT_MAX_CHARS = 3_200;
/** 相对 projectRoot 的常驻层目录（`_` 前缀：db:sync 跳过，不进 Memory 表） */
export const PINNED_MEMORY_DIR = "content/memories/_pinned";
export const PINNED_MEMORY_USER_FILE = "USER.md";
export const PINNED_MEMORY_AGENT_FILE = "AGENT.md";

/** 长期记忆每日衰减系数（decayMemories，挂 heartbeat 每日 cron） */
export const MEMORY_DECAY_FACTOR_PER_DAY = 0.95;
/** 衰减后低于该强度的记忆归档删除 */
export const MEMORY_ARCHIVE_THRESHOLD = 0.1;

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

/* ─── LLM 模型与厂商（W8 常量化收敛：全仓引用此处，禁止裸字符串） ─── */

/** DeepSeek 厂商 id（config.llm.providers key、provider 嗅探、credential key 共用） */
export const LLM_PROVIDER_DEEPSEEK = "deepseek";

/** 内置模型 id（与下方 CHAT_MODELS 注册表对齐；旧 id 由 llmClient 映射到 V4 Flash） */
export const LLM_MODEL_IDS = {
  DEEPSEEK_V4_FLASH: "deepseek-v4-flash",
  DEEPSEEK_V4_PRO: "deepseek-v4-pro",
  DEEPSEEK_VL2: "deepseek-vl2",
  /** 旧 id：映射到 V4 Flash 非思考 */
  DEEPSEEK_CHAT: "deepseek-chat",
  /** 旧 id：映射到 V4 Flash 思考 */
  DEEPSEEK_REASONER: "deepseek-reasoner",
} as const;

/**
 * 全局默认 LLM 模型 id 的最终兜底常量。
 * server 侧实际生效值见 config.llm.defaultModel（解析优先级：env DEFAULT_LLM_MODEL
 * > config.yaml llm.defaultModel > 本常量）；web / 纯静态场景直接用本常量。
 */
export const DEFAULT_LLM_MODEL = LLM_MODEL_IDS.DEEPSEEK_V4_FLASH;

/** Chat 可选模型（对齐 DeepSeek V4 API：https://api-docs.deepseek.com/guides/thinking_mode） */
export interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  /** 模型上下文窗口（token），用于 Auto-Compact 动态阈值 */
  contextWindowTokens?: number;
  /** 支持 thinking.type enabled/disabled */
  supportsThinking?: boolean;
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
    id: LLM_MODEL_IDS.DEEPSEEK_V4_FLASH,
    label: "DeepSeek V4 Flash",
    provider: LLM_PROVIDER_DEEPSEEK,
    contextWindowTokens: 128_000,
    supportsThinking: true,
    supportsVision: false,
    ocrFallback: true,
    inputHint: "纯文本模型 · 图片将 OCR 识别后以文字附在消息中发送",
    defaultTemperature: 0.7,
  },
  {
    id: LLM_MODEL_IDS.DEEPSEEK_V4_PRO,
    label: "DeepSeek V4 Pro",
    provider: LLM_PROVIDER_DEEPSEEK,
    contextWindowTokens: 128_000,
    supportsThinking: true,
    supportsVision: false,
    ocrFallback: true,
    inputHint: "纯文本模型 · 图片将 OCR 识别后以文字附在消息中发送",
    defaultTemperature: 0.7,
  },
  {
    id: LLM_MODEL_IDS.DEEPSEEK_VL2,
    label: "DeepSeek VL2（识图）",
    provider: LLM_PROVIDER_DEEPSEEK,
    contextWindowTokens: 64_000,
    supportsThinking: false,
    supportsVision: true,
    ocrFallback: false,
    inputHint: "多模态识图 · 支持直接发送图片（JPEG/PNG/WebP）",
    defaultTemperature: 0.7,
  },
  {
    id: LLM_MODEL_IDS.DEEPSEEK_CHAT,
    label: "DeepSeek Chat（旧 ID → V4 Flash 非思考）",
    provider: LLM_PROVIDER_DEEPSEEK,
    supportsThinking: true,
    defaultTemperature: 0.7,
  },
  {
    id: LLM_MODEL_IDS.DEEPSEEK_REASONER,
    label: "DeepSeek Reasoner（旧 ID → V4 Flash 思考）",
    provider: LLM_PROVIDER_DEEPSEEK,
    supportsThinking: true,
    reasoningRequired: true,
    defaultTemperature: 0.7,
  },
  { id: "moonshot-v1-auto", label: "Kimi Auto", provider: "kimi", supportsThinking: true, supportsVision: true, inputHint: "多模态 · 支持图片与文本", defaultTemperature: 0.6 },
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
  LLM_MODEL_IDS.DEEPSEEK_V4_FLASH,
  LLM_MODEL_IDS.DEEPSEEK_V4_PRO,
  LLM_MODEL_IDS.DEEPSEEK_VL2,
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

/* ─── Swarm 分层与队列上限（W8 单点定义，原 swarmBus / redisSwarmBus / swarmPermissionGuard 三处漂移） ─── */

/** Agent 间委托最大深度（防循环） */
export const SWARM_MAX_DEPTH = 10;
/** 单个 Agent 待处理消息队列上限 */
export const SWARM_MAX_QUEUE_SIZE = 100;

/** Swarm Agent 层级（与 schemas.agentTierSchema 同源） */
export const AGENT_TIERS = ["super", "manager", "sub"] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

/**
 * 各 tier 新建 Agent 的默认工具清单（单点定义，原 swarmInitializer / workspaceProvision /
 * loop/setup 三处独立维护）。使用处：swarmInitializer（super）、workspaceProvision（manager）、
 * loop/setup resolveToolsForAgentTier（sub 兜底）。
 */
export const TIER_DEFAULT_TOOLS: Record<AgentTier, string[]> = {
  super: [
    "native:web_search",
    "native:read_file",
    "native:write_file",
    "native:list_directory",
    "native:invoke_api",
    "native:async_task_run",
    "native:async_task_status",
    "native:async_task_cancel",
    "native:spawn_subagent",
    "native:session_rotate",
    "native:todo_write",
    "native:todo_read",
    "native:memory_create",
    "native:memory_update",
    "native:memory_search",
    "native:pinned_memory_read",
    "native:pinned_memory_write",
    "native:agent_create",
    "native:agent_update",
    "native:agent_delete",
    "native:agent_inspect",
    "native:agent_send_message",
    "native:workspace_create",
    "native:workspace_archive",
  ],
  manager: [
    "native:web_search",
    "native:read_file",
    "native:write_file",
    "native:list_directory",
    "native:invoke_api",
    "native:async_task_run",
    "native:async_task_status",
    "native:async_task_cancel",
    "native:spawn_subagent",
    "native:session_rotate",
    "native:todo_write",
    "native:todo_read",
    "native:memory_create",
    "native:memory_update",
    "native:memory_search",
    "native:pinned_memory_read",
    "native:pinned_memory_write",
    "native:agent_create_sub",
    "native:agent_send_message",
    "native:agent_report_back",
  ],
  sub: [
    "native:sleep",
    "native:async_task_run",
    "native:agent_report_back",
    "native:agent_notify_parent",
    "native:todo_write",
    "native:todo_read",
    "native:read_file",
    "native:list_directory",
    "native:web_search",
  ],
};

/** 内置 assistant（用户默认助手，manager tier）的工具清单 —— agentResolver 创建与补齐检查共用同一份 */
export const ASSISTANT_DEFAULT_TOOLS: string[] = [
  "native:web_search",
  "native:read_article",
  "native:scrape_web_page",
  "native:read_file",
  "native:write_file",
  "native:list_directory",
  "native:invoke_api",
  "native:spawn_subagent",
  "native:async_task_run",
  "native:session_rotate",
  "native:session_compact",
  "native:sleep",
  "native:git_status",
  "native:git_diff",
  "native:git_log",
  "native:memory_create",
  "native:memory_update",
  "native:memory_search",
  "native:pinned_memory_read",
  "native:pinned_memory_write",
  "native:todo_write",
  "native:todo_read",
  // 集成（联调已通：GitHub 全量只读+常用写；语雀 Cookie Web API；飞书仅 token 诊断——发消息需开机器人，文档搜索 API 404 待修）
  "native:github_search_repos",
  "native:github_get_repo",
  "native:github_get_file",
  "native:github_list_issues",
  "native:github_get_issue",
  "native:github_create_issue",
  "native:github_list_pull_requests",
  "native:github_get_pull_request",
  "native:github_list_branches",
  "native:github_get_branch",
  "native:github_list_workflows",
  "native:yuque_list_books",
  "native:yuque_get_book_toc",
  "native:yuque_create_doc",
  "native:yuque_update_doc",
  "native:yuque_delete_doc",
  "native:feishu_token_status",
  "skill:*",
  "mcp:filesystem",
];

/* ─── Agent 运行时阈值（W8 常量化收敛） ─── */

/** Agent 工具结果进 LLM 上下文的单条截断上限（reactLoop snapshot 与 read_article 同源） */
export const AGENT_TOOL_RESULT_MAX_CHARS = 16_000;

/** 心跳连续失败达到该次数时邮件告警一次（复用 send_email 通道） */
export const HEARTBEAT_MAX_CONSECUTIVE_FAILURES = 3;

/** pending 审批默认过期毫秒（24h；env APPROVAL_PENDING_TTL_MS 可覆盖，0 关闭 TTL） */
export const APPROVAL_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
