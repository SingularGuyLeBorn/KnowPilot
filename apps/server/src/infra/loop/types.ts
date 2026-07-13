/**
 * Agent Loop 类型 — Turn Snapshot + Transport + Hooks
 *
 * 设计对齐 Pi Harness：
 * - Turn Snapshot：进入 run 时冻结 model/tools/上限，飞行中配置变更不影响本轮
 * - Transport：sync / stream 只换「怎么拿 LLM 结果」，不换 loop 状态机
 * - Hooks：观测与 SSE 推送，禁止在 hook 里改 phase
 */

import type { AppConfig } from "../config.js";
import type { ServiceContainer } from "../serviceContainer.js";
import type { LlmMessage, LlmToolCall, LlmToolDefinition } from "../llmClient.js";
import type { StoredToolCall } from "../chatHistory.js";
import type { AgentRunPhase } from "./phase.js";
import type { ReasoningEffort } from "@knowpilot/shared";

/** 进入 run 时冻结的配置快照（学 Pi Turn Snapshot） */
export interface TurnSnapshot {
  model: string;
  tools: string[];
  maxRounds: number;
  maxToolCalls: number;
  toolResultMaxChars: number;
}

export interface LlmTurnResult {
  content: string | null;
  reasoningContent?: string | null;
  toolCalls: LlmToolCall[];
  tokenUsage?: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
}

/**
 * LLM 传输层：sync 一次返回；stream 在 complete 内部边收边调 hooks，最终仍返回聚合结果。
 */
export interface LlmTransport {
  complete(args: {
    messages: LlmMessage[];
    tools?: LlmToolDefinition[];
    signal?: AbortSignal;
    /** false = 合成终轮，不传 tools */
    withTools: boolean;
  }): Promise<LlmTurnResult>;
}

export interface LoopHooks {
  onPhase?(to: AgentRunPhase, from: AgentRunPhase): void;
  onRoundStart?(round: number): void;
  onThinking?(round: number, delta: string): void;
  /** 流式正文 delta；非流式可不实现 */
  onToken?(delta: string): void;
  onIntermediateContent?(round: number, content: string): void;
  onToolStart?(info: { toolCallId: string; name: string; args: Record<string, unknown>; round: number }): void;
  onToolEnd?(info: {
    toolCallId: string;
    name: string;
    result: unknown;
    round: number;
  }): void;
  onProgress?(message: string): void;
  /** Steering / Follow-up 已注入到 messages（落库后调用） */
  onInjected?(info: { kind: "steer" | "follow_up"; content: string; messageId?: string }): void;
}

export interface ReactLoopInput {
  config: AppConfig;
  services: ServiceContainer;
  /** Turn Snapshot 的源；model/tools 在入口冻结 */
  agent: { model: string; systemPrompt: string; tools: string[] };
  messages: LlmMessage[];
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  transport: LlmTransport;
  hooks?: LoopHooks;
  signal?: AbortSignal;
  sessionId?: string;
  agentMeta?: {
    id: string;
    model: string;
    systemPrompt: string;
    tools: string[];
    tier?: string;
    parentId?: string | null;
    workspaceId?: string | null;
  };
  runOrigin?: "user" | "parent" | "heartbeat";
  /** 覆盖 snapshot.toolResultMaxChars（stream 用 micro-compact 阈值） */
  toolResultMaxChars?: number;
  /** 压缩阶段 SSE（仅 stream 传入；type-only 依赖 AgentStreamEvent） */
  compactEmit?: (event: import("../agentStream.js").AgentStreamEvent) => void;
  /**
   * 运行中消息注入（Steering / Follow-up）。
   * 由 SessionStreamHub 提供；缺省则本 run 不支持 mid-run 注入。
   */
  runQueues?: {
    takeSteer: () => Array<{ id: string; content: string }>;
    takeFollowUp: () => Array<{ id: string; content: string }>;
  };
}

export interface ReactLoopResult {
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
  /** 结束时的 phase（应为 done） */
  phase: AgentRunPhase;
  /** 是否因工具预算触发合成/停止 */
  hitToolBudget: boolean;
}

/** Stream facade 传入 transport 的 LLM 选项 */
export interface StreamLlmOptions {
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
}
