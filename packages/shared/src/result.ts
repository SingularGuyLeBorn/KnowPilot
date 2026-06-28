/**
 * @knowpilot/shared — AI-native 操作结果类型
 *
 * 所有 tRPC mutation 统一返回此结构，让 Agent 能基于结构化上下文做决策。
 * 拒绝仅返回状态码或简单 message。
 */

export interface OperationError {
  /** 机器可读错误码 */
  code: string;

  /** 人 / Agent 可读的错误摘要 */
  message: string;

  /** 结构化详情：冲突值、校验失败字段、当前状态快照等 */
  details?: Record<string, unknown>;

  /** 关联输入字段 */
  field?: string;

  /** 自然语言修复建议 */
  suggestion?: string;

  /** Agent 是否应重试 */
  retryable: boolean;

  /** 可直接调用的下一步动作 */
  suggestedAction?: {
    /** tRPC procedure 路径，例如 "agent.list" */
    procedure: string;
    /** 建议传入的输入参数 */
    input?: Record<string, unknown>;
    /** 为什么建议这个动作 */
    reason: string;
  };
}

export interface OperationMeta {
  /** 链路追踪 ID */
  requestId: string;

  /** 操作标识，例如 "create"、"update"、"delete" */
  operation: string;

  /** 实体名，例如 "post"、"agent" */
  entity: string;

  /** ISO 8601 时间戳 */
  timestamp: string;

  /** 处理耗时（毫秒） */
  durationMs?: number;
}

export interface NextStep {
  /** 自然语言动作描述 */
  action: string;

  /** 可调用的 tRPC procedure */
  procedure?: string;

  /** 建议输入 */
  input?: Record<string, unknown>;

  /** 推荐理由 */
  reason: string;
}

export interface OperationResult<T = unknown> {
  /** 操作是否成功 */
  success: boolean;

  /** 成功时的数据 */
  data?: T;

  /** 失败时的错误上下文 */
  error?: OperationError;

  /** 操作后的实体/系统状态快照 */
  state?: Record<string, unknown>;

  /** 元数据 */
  meta: OperationMeta;

  /** 成功后建议的下一步动作 */
  nextSteps?: NextStep[];
}

/** 生成唯一 requestId */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
