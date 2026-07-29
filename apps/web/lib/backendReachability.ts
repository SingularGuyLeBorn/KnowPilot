/**
 * 后端可达性判定：429/超时 ≠ 宕机。
 * Chat 误把 rate-limit 当成「后端未连接」会整页锁死（queries enabled:false）。
 */

export function isTransientTrpcFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    data?: { httpStatus?: number; code?: string };
    shape?: { data?: { httpStatus?: number; code?: string } };
    message?: string;
  };
  const status = e.data?.httpStatus ?? e.shape?.data?.httpStatus;
  if (status === 429 || status === 408 || status === 503) return true;
  const code = e.data?.code ?? e.shape?.data?.code;
  if (code === "TOO_MANY_REQUESTS" || code === "TIMEOUT") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /TOO_MANY_REQUESTS|429|过于频繁|ECONNRESET|ETIMEDOUT/i.test(msg);
}

/** 仅当关键性失败（非瞬态限流）才视为后端不可用 */
export function isBackendDown(errors: Array<unknown | null | undefined>): boolean {
  const hard = errors.filter((e) => e != null && !isTransientTrpcFailure(e));
  return hard.length > 0;
}
