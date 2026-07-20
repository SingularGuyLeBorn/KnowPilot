/**
 * Context 钩子链 — 每次 LLM 调用前的上下文工程总闸（W4）。
 *
 * 契约（对齐 pi extensions `context` 事件）：
 * - 每次 transport.complete 前按 order 升序跑已注册钩子，可改写 messages / systemPrompt，
 *   或经 prependUserContext 以 user 角色注入「末尾前」上下文块。
 * - 内建钩子 order 区间 100–999；外部扩展请用 1000+。
 * - 同名 register = 覆盖（dev warn）；单钩子异常 = warn 跳过，不阻断后续。
 * - 本模块是叶子：不 import loop/reactLoop/prisma；需要的能力经 input.ctx 注入。
 * - v1 内建钩子 enabled: round === 1，保持「每 run 开头注入一次」的现状语义；
 *   「每轮生效」留给后续具体钩子自行选择。
 */

import type { Agent } from "@knowpilot/shared";
import type { LlmMessage } from "./llmClient.js";
import type { NativeToolContext } from "./tools/native/types.js";
import {
  buildAllMemoryHints,
  buildAgentToolGuide,
  buildTierIdentityHint,
} from "./promptBuilder.js";

const SLOW_HOOK_MS = 500;

export interface ContextHookInput {
  /** 当前 agent（只读；字段以钩子所需为准，不必是 DB 全量行） */
  agent: Agent;
  sessionId: string;
  runId: string;
  /** 当前 ReAct 轮次（1-based，与 reactLoop.onRoundStart 对齐） */
  round: number;
  /** 当前待发送消息列表（副本，可改写） */
  messages: LlmMessage[];
  /** 当前 system prompt（副本，可改写） */
  systemPrompt: string;
  /** 便于钩子访问 prisma/services（注入而非 import） */
  ctx: NativeToolContext;
  /**
   * 同一次 runContextHooks 调用内共享的临时袋（钩子间传片段；勿持久化）。
   * 测试可设 `__testMemoryHint` 注入固定记忆文案以绕过 DB。
   */
  scratch: Record<string, unknown>;
}

export interface ContextHookResult {
  /** 改写后的消息列表（过滤/重排/追加） */
  messages?: LlmMessage[];
  /** 改写后的 system prompt */
  systemPrompt?: string;
  /** 便捷：以 user 角色注入到末尾前的上下文块 */
  prependUserContext?: string;
}

export interface ContextHook {
  /** 唯一名（如 "memory" / "tier-identity" / "tool-guide"） */
  name: string;
  /** 小先跑；内建 100–999，外部 1000+ */
  order: number;
  /** 缺省 true */
  enabled?: (input: ContextHookInput) => boolean;
  run: (input: ContextHookInput) => Promise<ContextHookResult | void> | ContextHookResult | void;
}

const registry = new Map<string, ContextHook>();
let builtinsRegistered = false;

/** 同名覆盖（与 tool registry 语义一致；重复注册时 dev warn） */
export function registerContextHook(hook: ContextHook): void {
  if (registry.has(hook.name)) {
    console.warn(`[contextHooks] 同名钩子覆盖: ${hook.name}`);
  }
  registry.set(hook.name, hook);
}

function sortedHooks(): ContextHook[] {
  return [...registry.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** 将 prependUserContext 插入消息列表末尾之前（保留最后一条在尾部） */
function applyPrependUserContext(messages: LlmMessage[], block: string): LlmMessage[] {
  if (!block) return messages;
  const injected: LlmMessage = { role: "user", content: block };
  if (messages.length === 0) return [injected];
  const head = messages.slice(0, -1);
  const tail = messages[messages.length - 1]!;
  return [...head, injected, tail];
}

/**
 * 顺序执行钩子并逐个应用结果。
 * 返回最终 messages / systemPrompt（已是新对象，调用方可直接替换）。
 */
export async function runContextHooks(
  input: ContextHookInput,
): Promise<{ messages: LlmMessage[]; systemPrompt: string }> {
  let messages = input.messages.map((m) => ({ ...m }));
  let systemPrompt = input.systemPrompt;
  const scratch = input.scratch ?? {};

  for (const hook of sortedHooks()) {
    const hookInput: ContextHookInput = {
      ...input,
      messages: messages.map((m) => ({ ...m })),
      systemPrompt,
      scratch,
    };
    if (hook.enabled && !hook.enabled(hookInput)) continue;

    const started = Date.now();
    try {
      const result = await hook.run(hookInput);
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_HOOK_MS) {
        console.warn(`[contextHooks] 钩子 ${hook.name} 耗时 ${elapsed}ms（>${SLOW_HOOK_MS}ms）`);
      } else if (process.env.DEBUG_CONTEXT_HOOKS === "1") {
        console.debug(`[contextHooks] 钩子 ${hook.name} 耗时 ${elapsed}ms`);
      }
      if (!result) continue;
      if (result.messages) {
        messages = result.messages.map((m) => ({ ...m }));
      }
      if (typeof result.systemPrompt === "string") {
        systemPrompt = result.systemPrompt;
      }
      if (typeof result.prependUserContext === "string" && result.prependUserContext) {
        messages = applyPrependUserContext(messages, result.prependUserContext);
      }
    } catch (err) {
      console.warn(
        `[contextHooks] 钩子 ${hook.name} 异常，已跳过:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { messages, systemPrompt };
}

/** 从消息列表取最近一条 user 文本（供 memory 检索关键词） */
function latestUserText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string" && m.content.trim()) {
      return m.content;
    }
  }
  return "";
}

const roundOneOnly = (input: ContextHookInput) => input.round === 1;

/**
 * 内建钩子：把 promptBuilder 既有注入迁为钩子（文案不变）。
 * 拼装顺序保持历史 buildSystemPromptWithHints：
 *   base + identity + memory + (\\n\\n + guide) + extras
 * memory 仍 order=100 先跑（完成检索），片段入 scratch；agent-extras(400) 做最终合成。
 */
export function ensureBuiltinContextHooks(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;

  registerContextHook({
    name: "memory",
    order: 100,
    enabled: roundOneOnly,
    run: async (input) => {
      const testHint = input.scratch.__testMemoryHint;
      if (typeof testHint === "string") {
        input.scratch.__memoryHint = testHint;
        return;
      }
      // 空 userText 时 buildMemoryContext 跳过动态检索，但仍会带上 pinned（与旧 run 路径一致）
      const userText = latestUserText(input.messages);
      input.scratch.__memoryHint = await buildAllMemoryHints(input.ctx.services, userText, {
        agentId: input.agent.id,
        sessionId: input.sessionId || null,
      });
    },
  });

  registerContextHook({
    name: "tier-identity",
    order: 200,
    enabled: roundOneOnly,
    run: (input) => {
      input.scratch.__identityHint = buildTierIdentityHint(
        input.agent.tier as string | null | undefined,
        input.agent.name,
      );
    },
  });

  registerContextHook({
    name: "tool-guide",
    order: 300,
    enabled: roundOneOnly,
    run: (input) => {
      input.scratch.__toolGuide = buildAgentToolGuide(input.agent.tools ?? []);
    },
  });

  registerContextHook({
    name: "agent-extras",
    order: 400,
    enabled: roundOneOnly,
    run: (input) => {
      // drift 目前仅 logAgentDrift，不注入 system prompt；预留 extras 槽位
      const extras =
        typeof input.scratch.__agentExtras === "string" ? input.scratch.__agentExtras : "";
      const base = input.systemPrompt || "你是 KnowPilot 助手。";
      const identityHint = typeof input.scratch.__identityHint === "string" ? input.scratch.__identityHint : "";
      const memoryHint = typeof input.scratch.__memoryHint === "string" ? input.scratch.__memoryHint : "";
      const guide = typeof input.scratch.__toolGuide === "string" ? input.scratch.__toolGuide : "";
      const composed = guide
        ? `${base}${identityHint}${memoryHint}\n\n${guide}${extras}`
        : `${base}${identityHint}${memoryHint}${extras}`;
      return { systemPrompt: composed };
    },
  });
}

/** 测试辅助：清空注册表；默认重新挂载内建钩子 */
export function __resetContextHooksForTests(opts?: { registerBuiltins?: boolean }): void {
  registry.clear();
  builtinsRegistered = false;
  if (opts?.registerBuiltins !== false) {
    ensureBuiltinContextHooks();
  }
}

// 模块加载即挂载内建钩子（幂等）
ensureBuiltinContextHooks();
