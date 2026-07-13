/**
 * Native 工具共享类型（PR-4：按域拆分的公共契约）
 */

import type { AppConfig } from "../../config.js";
import type { ServiceContainer } from "../../serviceContainer.js";
import type { PrismaClient } from "@prisma/client";

export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NativeToolContext {
  config: AppConfig;
  services: ServiceContainer;
  prisma?: PrismaClient;
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  /** 当前 Chat 会话 — async_task_run 等需要 */
  sessionId?: string;
  agentSnapshot?: {
    id: string;
    model: string;
    systemPrompt: string;
    tools: string[];
    tier?: string;
    workspaceId?: string | null;
    parentId?: string | null;
  };
  /** 当前 ReAct 轮次是否仍在工具调用中（向上发消息时机约束 #41） */
  inToolRound?: boolean;
  /** 本次运行的触发来源：user=用户直接对话；parent=上级下发；heartbeat=心跳 */
  runOrigin?: "user" | "parent" | "heartbeat";
}

export type NativeToolHandler = (
  args: Record<string, unknown>,
  ctx: NativeToolContext,
) => Promise<unknown>;

/** LLM 常把 boolean 写成字符串 "true"/"false"，严格 === true 会误判为异步投递 */
export function coerceToolBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}
