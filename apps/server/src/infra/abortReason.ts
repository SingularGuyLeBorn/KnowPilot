/**
 * AbortSignal.reason 统一约定：调用方 abort(code) 时附带原因码，
 * 错误文案按码生成——禁止一律写成「用户中断」。
 */

export type AbortReasonCode =
  | "user"
  | "timeout"
  | "cancel"
  | "pool"
  | "session_stop"
  | "unknown";

const MESSAGES: Record<AbortReasonCode, string> = {
  user: "流式输出已被用户中断",
  timeout: "任务执行超时被中止",
  cancel: "任务已被主动取消",
  pool: "任务被调度层中止（槽位回收或池取消）",
  session_stop: "会话已停止，关联任务被中止",
  unknown: "任务已中止（系统信号）",
};

export function isAbortReasonCode(value: unknown): value is AbortReasonCode {
  return typeof value === "string" && value in MESSAGES;
}

/** 从 AbortSignal.reason / Error 提取原因码 */
export function resolveAbortReasonCode(signal?: AbortSignal | null, err?: unknown): AbortReasonCode {
  const raw = signal?.reason;
  if (isAbortReasonCode(raw)) return raw;
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("超时")) return "timeout";
    if (msg.includes("用户中断")) return "user";
    if (msg.includes("已取消") || msg.includes("主动取消")) return "cancel";
    if (msg.includes("调度") || msg.includes("池")) return "pool";
    if (msg.includes("会话已停止")) return "session_stop";
    if (err.name === "AbortError") return "unknown";
  }
  if (signal?.aborted) return "unknown";
  return "unknown";
}

export function messageFromAbortReason(code: AbortReasonCode): string {
  return MESSAGES[code];
}

export function messageFromAbortSignal(signal?: AbortSignal | null, err?: unknown): string {
  return messageFromAbortReason(resolveAbortReasonCode(signal, err));
}

/** 构造带 AbortError 名的标准中断错误（文案按 signal.reason） */
export function makeAbortError(signal?: AbortSignal | null, fallback: AbortReasonCode = "unknown"): Error {
  const code = signal?.aborted ? resolveAbortReasonCode(signal) : fallback;
  const err = new Error(messageFromAbortReason(code));
  err.name = "AbortError";
  return err;
}

export function abortController(controller: AbortController, code: AbortReasonCode): void {
  controller.abort(code);
}

/** 是否为中断类错误（含历史「用户中断」文案与 AbortError 名） */
export function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return (
    err.message.includes("用户中断") ||
    err.message.includes("已中止") ||
    err.message.includes("已被主动取消") ||
    err.message.includes("超时被中止") ||
    err.message.includes("调度层中止") ||
    err.message.includes("会话已停止")
  );
}
