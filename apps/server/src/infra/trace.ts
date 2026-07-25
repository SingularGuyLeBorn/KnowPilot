/**
 * trace_id 贯穿基础设施（P2 可观测性）
 *
 * 设计：
 * - AsyncLocalStorage 承载 trace_id，深层调用经 getTraceId() 零参数读取，无需层层传参。
 * - Express 中间件从 `x-trace-id` header 透传（web→server），缺失时生成 uuid v4。
 * - 响应回写 `x-trace-id` header，前端可记录用于排障关联。
 * - 非请求上下文（心跳 / 后台任务 / 启动恢复）生成一次性 trace_id 包裹整段执行。
 *
 * 使用：
 *   import { getTraceId, formatTrace, runWithTrace, traceMiddleware } from "./trace.js";
 *   console.log(`${formatTrace()} agent run done`);   // → "[traceId=abc123] agent run done"
 *   await runWithTrace(async () => { ... });           // 后台任务自动建 trace 作用域
 */

import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import type { Request, Response, NextFunction } from "express";

const TRACE_HEADER = "x-trace-id";

const traceStorage = new AsyncLocalStorage<string>();

/** 读取当前作用域 trace_id；无作用域时返回 undefined。 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore();
}

/** 生成新 trace_id（uuid v4 去横线，紧凑 32 字符）。 */
export function newTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * 在新 trace_id 作用域内执行 fn；fn 内所有 getTraceId() 返回同一 id。
 * 用于非请求上下文（心跳、后台任务、启动恢复）。
 */
export function runWithTrace<T>(fn: () => Promise<T>): Promise<T>;
export function runWithTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T>;
export function runWithTrace<T>(arg1: string | (() => Promise<T>), arg2?: () => Promise<T>): Promise<T> {
  const traceId = typeof arg1 === "string" ? arg1 : newTraceId();
  const fn = typeof arg1 === "function" ? arg1 : arg2!;
  return traceStorage.run(traceId, fn);
}

/** 日志前缀：有 trace_id 时返回 `[traceId=xxx] `，否则返回空串。 */
export function formatTrace(): string {
  const id = traceStorage.getStore();
  return id ? `[traceId=${id}] ` : "";
}

/**
 * Express 中间件：透传或生成 trace_id，写入 ALS 作用域 + 响应 header。
 * 必须挂在所有路由之前（rate-limit 之后即可）。
 */
export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = typeof req.headers[TRACE_HEADER] === "string" ? (req.headers[TRACE_HEADER] as string) : "";
  const traceId = incoming.trim() || newTraceId();
  res.setHeader(TRACE_HEADER, traceId);
  traceStorage.run(traceId, () => next());
}
