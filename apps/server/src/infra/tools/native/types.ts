/**
 * Native 工具共享类型（PR-4：按域拆分的公共契约）
 */

import type { AppConfig } from "../../config.js";
import type { ServiceContainer } from "../../serviceContainer.js";
import type { ResolveAgentFn } from "../../agentResolver.js";
import type { PrismaClient } from "@prisma/client";
import type { ToolConcurrencyClass } from "../types.js";
import type { RunRollbackStack } from "../rollback.js";

export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 并发分级：A=纯CPU/内存高并发 B=网络只读中并发 C=本地进程低并发 D=写入/副作用串行（缺省按 B） */
  concurrencyClass?: ToolConcurrencyClass;
  /**
   * D 类（写入/副作用）标记：run 失败（非用户 abort）时逆序补偿。
   * 与 approvalGate.DESTRUCTIVE_NATIVE_OPS 对齐；补偿实现经 registerNativeDomain 第三参数挂入。
   */
  destructive?: boolean;
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
  /**
   * Agent 解析（默认 assistant 查找/补齐/创建）— W4 起由 createAgentToolContext 注入，
   * 工具层不再直接 import agentRuntime（环内模块）。缺省时回退到 agentResolver 默认实现。
   */
  resolveAgent?: ResolveAgentFn;
  /**
   * 本 run 的 D 类工具回滚栈（reactLoop 注入；缺省 = 不跟踪，如审批直执/单测直接调工具）。
   */
  rollbackStack?: RunRollbackStack;
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
