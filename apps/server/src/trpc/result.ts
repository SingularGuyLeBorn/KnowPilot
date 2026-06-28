/**
 * 服务端 OperationResult 构造工具
 *
 * 统一所有 mutation 的返回结构，确保 AI-native 反馈一致性。
 */

import { OperationResult, OperationError, OperationMeta, NextStep, generateRequestId } from "@knowpilot/shared";

interface BuildSuccessOptions<T> {
  data?: T;
  state?: Record<string, unknown>;
  nextSteps?: NextStep[];
  operation: string;
  entity: string;
  durationMs?: number;
}

interface BuildErrorOptions {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
  suggestion?: string;
  retryable?: boolean;
  suggestedAction?: OperationError["suggestedAction"];
  state?: Record<string, unknown>;
  operation: string;
  entity: string;
  durationMs?: number;
}

function buildMeta(operation: string, entity: string, durationMs?: number): OperationMeta {
  return {
    requestId: generateRequestId(),
    operation,
    entity,
    timestamp: new Date().toISOString(),
    durationMs,
  };
}

export function success<T>(options: BuildSuccessOptions<T>): OperationResult<T> {
  return {
    success: true,
    data: options.data,
    state: options.state,
    meta: buildMeta(options.operation, options.entity, options.durationMs),
    nextSteps: options.nextSteps,
  };
}

export function failure(options: BuildErrorOptions): OperationResult<never> {
  return {
    success: false,
    error: {
      code: options.code,
      message: options.message,
      details: options.details,
      field: options.field,
      suggestion: options.suggestion,
      retryable: options.retryable ?? false,
      suggestedAction: options.suggestedAction,
    },
    state: options.state,
    meta: buildMeta(options.operation, options.entity, options.durationMs),
  };
}

/** 将 TRPCError / 未知错误转换为 OperationResult */
export function failureFromError(
  error: unknown,
  operation: string,
  entity: string,
  fallbackCode = "INTERNAL_SERVER_ERROR"
): OperationResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  return failure({
    code: fallbackCode,
    message: `执行 ${operation} 时发生内部错误：${message}。请检查输入参数或查看服务端日志。`,
    details: { originalError: message },
    suggestion: "如果问题持续，请记录 requestId 并联系管理员。",
    retryable: false,
    operation,
    entity,
  });
}
