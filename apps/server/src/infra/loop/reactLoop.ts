/**
 * 统一 ReAct Loop 内核 — sync / stream 共用
 *
 * 不变量：
 * 1. phase 只经 createPhaseMachine.transition 变更
 * 2. 工具预算在 tool_batch 前切分；deferred 必须回写 tool 消息
 * 3. Turn Snapshot 在入口冻结，本 run 内不改 maxRounds/maxToolCalls/model
 * 4. hooks 只观测，禁止改 phase / messages（由内核写）
 */

import { resolveEffectiveAgentModel, type LlmMessage, type LlmToolCall } from "../llmClient.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  partitionToolCallsByBudget,
  TOOL_BUDGET_SKIP_RESULT,
  type ToolRegistryEntry,
} from "../agentTools.js";
import {
  assertLlmBudget,
  defaultLlmBudgetReserveEstimate,
  markTokensWasted,
  recordTokenUsage,
  releaseLlmBudgetReservation,
  tryReserveLlmBudget,
} from "../llmBudget.js";
import { maybeCompactMessages, persistCompactResult } from "../autoCompact.js";
import { completeWithOverflowCompact } from "../overflowCompactRetry.js";
import { sanitizePostCompactAssistantContent, type StoredToolCall } from "../chatHistory.js";
import { RunRollbackStack, type RunRollbackReport } from "../tools/rollback.js";
import { waitApprovalResolution, type ApprovalResolution } from "../approvalGate.js";
import {
  buildAskUserResumeMessage,
  waitAskUserResolution,
  type AskUserResolution,
} from "../askUserGate.js";
import { getStreamHub } from "../sessionStreamHub.js";
import {
  DEFAULT_SUBAGENT_TOOLS,
  resolveToolsForAgentTier,
  parseToolCall,
} from "./setup.js";
import { AGENT_TOOL_RESULT_MAX_CHARS } from "@knowpilot/shared";
import { createPhaseMachine } from "./phase.js";
import { REFLECTION_UNPASSED_MARK } from "./reflection.js";
import type { ReactLoopInput, ReactLoopResult, TurnSnapshot } from "./types.js";
import { isAbortLikeError, makeAbortError } from "../abortReason.js";
import { runContextHooks, type ContextHookInput } from "../contextHooks.js";
import type { Agent } from "@knowpilot/shared";
import { buildSystemPromptSkeleton } from "../promptBuilder.js";
import { formatTrace } from "../trace.js";
import { offloadToolResultIfNeeded } from "../toolResultOffload.js";
import { checkToolLoop, createLoopGuardState } from "./toolLoopGuard.js";
/** W11：Run.output 活状态快照写回节流间隔（每轮 tool_batch 后至多写一次） */
const RUN_SNAPSHOT_THROTTLE_MS = 5000;

/** W11：审批执行结果注入消息的最大长度（超出截断，防爆上下文） */
const APPROVAL_RESULT_MAX_CHARS = 2000;

/** W11：从工具结果中读取审批 pending 标记（agentTools runOne 捕获 PENDING_APPROVAL 时写入） */
function readApprovalPendingMarker(
  result: unknown,
): { approvalId: string; toolName?: string; decisionScope?: string } | null {
  if (!result || typeof result !== "object") return null;
  const marker = (result as { approvalPending?: unknown }).approvalPending;
  if (
    marker &&
    typeof marker === "object" &&
    typeof (marker as { approvalId?: unknown }).approvalId === "string"
  ) {
    return marker as { approvalId: string; toolName?: string; decisionScope?: string };
  }
  return null;
}

/** ask_user：工具成功返回时附带 askUserPending 标记 */
function readAskUserPendingMarker(result: unknown): { askId: string } | null {
  if (!result || typeof result !== "object") return null;
  const marker = (result as { askUserPending?: unknown }).askUserPending;
  if (
    marker &&
    typeof marker === "object" &&
    typeof (marker as { askId?: unknown }).askId === "string"
  ) {
    return { askId: (marker as { askId: string }).askId };
  }
  return null;
}

function truncateForMessage(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > APPROVAL_RESULT_MAX_CHARS ? `${text.slice(0, APPROVAL_RESULT_MAX_CHARS)}…` : text;
}

/**
 * 工具结果超 maxChars 时，优先截断 result 的长文本字段（content/text/transcript/excerpt），
 * 保留其他元信息字段完整，避免把整个 JSON 整体 slice 导致 content 在中间被砍。
 * 返回截断后的 JSON 字符串；若无法智能截断（无长文本字段）返回 null 由调用方整体 slice。
 */
function truncateToolResultContent(result: unknown, maxChars: number): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const obj = result as Record<string, unknown>;
  const longTextFields = ["content", "text", "transcript", "excerpt", "html", "markdown"];
  // 找出最长的文本字段
  let target: string | null = null;
  let targetKey = "";
  for (const k of longTextFields) {
    const v = obj[k];
    if (typeof v === "string" && v.length > (target?.length ?? 0)) {
      target = v;
      targetKey = k;
    }
  }
  if (!target || target.length < maxChars * 0.3) return null;

  // 计算除目标字段外的其他字段 JSON 长度
  const otherFields = { ...obj };
  delete otherFields[targetKey];
  const otherJson = JSON.stringify(otherFields);
  const overhead = otherJson.length + 20; // key 名 + 引号 + 省略号标记

  // 给 content 留出 maxChars - overhead - 余量
  const budget = Math.max(maxChars - overhead - 200, Math.floor(maxChars * 0.5));
  if (budget <= 0) return null;

  const truncatedContent = target.slice(0, budget) + `\n…[content TRUNCATED, original=${target.length} chars, kept=${budget}]`;
  const truncatedObj = { ...otherFields, [targetKey]: truncatedContent };
  return JSON.stringify(truncatedObj);
}

/** W11：审批决策后的续跑注入消息（经 injectUserMessages 显式机制进入原 session 与 llmMessages） */
function buildApprovalResumeMessage(resolution: ApprovalResolution): string {
  const base = `approvalId=${resolution.approvalId}，操作：${resolution.toolName}`;
  if (resolution.outcome === "user_replied") {
    return (
      `用户通过邮件回复了审批（${base}）：\n"""\n${resolution.answer ?? ""}\n"""\n` +
      `请根据回复内容判断用户是否同意执行该操作。如果同意，请直接调用原工具 ${resolution.toolName}（携带 approvalId=${resolution.approvalId}，审批已授权，不会再次拦截）；如果不同意，请向用户说明并收尾。`
    );
  }
  if (resolution.outcome === "approved") {
    const result = resolution.execResult;
    const failed =
      result &&
      typeof result === "object" &&
      ("error" in (result as Record<string, unknown>) ||
        (result as { success?: unknown }).success === false);
    if (failed) {
      return `人工审批已通过但执行失败（${base}）。失败信息：${truncateForMessage(result)}\n该操作未生效，请向用户说明情况并收尾，或改用其他方案。`;
    }
    return `人工审批已通过（${base}），该操作已由审批流程执行完成。执行结果：${truncateForMessage(result)}\n请基于该结果继续完成任务，不要重复调用同一工具。`;
  }
  if (resolution.outcome === "expired") {
    return `人工审批超时已过期（${base}），该操作未执行。请向用户说明情况并收尾，或改用其他不需要审批的方案。`;
  }
  return `人工审批被拒绝（${base}），该操作未执行。请向用户说明情况并收尾，或改用其他不需要审批的方案。`;
}

/** 将钩子产出的 systemPrompt 写回消息列表中的 system 条（无则前置） */
function applySystemPromptToMessages(messages: LlmMessage[], systemPrompt: string): LlmMessage[] {
  const idx = messages.findIndex((m) => m.role === "system");
  if (idx >= 0) {
    const next = messages.map((m, i) => (i === idx ? { ...m, content: systemPrompt } : m));
    return next;
  }
  return [{ role: "system", content: systemPrompt }, ...messages];
}

function buildHookAgent(input: ReactLoopInput): Agent {
  const meta = input.agentMeta;
  return {
    id: meta?.id ?? "unknown",
    name: meta?.name ?? "",
    description: null,
    model: input.agent.model,
    systemPrompt: input.agent.systemPrompt,
    tools: meta?.tools ?? input.agent.tools,
    // 无 tier 时不注入身份段（与旧 buildTierIdentityHint(undefined) 一致；禁止默认 sub）
    tier: (meta?.tier ?? null) as unknown as Agent["tier"],
    workspaceId: meta?.workspaceId ?? null,
    parentId: meta?.parentId ?? null,
    heartbeatModel: null,
    heartbeat: null,
    status: "active",
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** 每次 LLM complete 前跑 context 钩子链，写回 llmMessages */
async function applyContextHooksBeforeComplete(
  input: ReactLoopInput,
  toolCtx: ReturnType<typeof createAgentToolContext>,
  llmMessages: LlmMessage[],
  round: number,
  runId: string | undefined,
): Promise<LlmMessage[]> {
  // 始终以骨架为钩子输入（避免 round===1 在 synthesizing 再跑时叠加重写）
  const skeleton = buildSystemPromptSkeleton(
    input.agentMeta?.systemPrompt ?? input.agent.systemPrompt,
  );

  const hookInput: ContextHookInput = {
    agent: buildHookAgent(input),
    sessionId: input.sessionId ?? "",
    runId: runId ?? "",
    round,
    messages: llmMessages.map((m) => ({ ...m })),
    systemPrompt: skeleton,
    ctx: toolCtx,
    scratch: {},
  };
  const hooked = await runContextHooks(hookInput);
  // 无钩子改写 systemPrompt（如 round>1 内建全跳过）→ 保留消息里已注入的 system，防被骨架冲掉
  if (hooked.systemPrompt === skeleton) {
    return hooked.messages;
  }
  return applySystemPromptToMessages(hooked.messages, hooked.systemPrompt);
}

function pushThinking(executedTools: StoredToolCall[], round: number, delta: string) {
  if (!delta) return;
  const id = `think_${round}`;
  const existing = executedTools.find((t) => t.id === id);
  if (existing) {
    existing.result = String(existing.result ?? "") + delta;
  } else {
    executedTools.push({
      id,
      name: "__thinking__",
      args: { round },
      result: delta,
      kind: "thinking",
    });
  }
}

function pushIntermediateContent(executedTools: StoredToolCall[], round: number, content: string) {
  if (!content?.trim()) return;
  const id = `content_${round}`;
  const existing = executedTools.find((t) => t.id === id);
  if (existing) {
    existing.result = String(existing.result ?? "") + content;
  } else {
    executedTools.push({
      id,
      name: "__content__",
      args: { round },
      result: content,
      kind: "content",
    });
  }
}

function appendToolResultMessages(
  llmMessages: LlmMessage[],
  executedTools: StoredToolCall[],
  items: Array<{ call: LlmToolCall; name: string; args: Record<string, unknown>; result: unknown; kind?: StoredToolCall["kind"] }>,
  maxChars: number,
  offloadCtx?: {
    config: ReactLoopInput["config"];
    sessionId?: string;
    runId?: string;
    onArtifact?: (a: {
      type: string;
      title?: string;
      path: string;
      mime?: string;
      toolCallId: string;
      toolName: string;
    }) => void;
  },
) {
  for (const item of items) {
    let resultForStore = item.result;
    let resultForLlm = item.result;

    // DeerFlow：大结果落盘，LLM 只拿路径 + 预览
    if (offloadCtx?.config) {
      try {
        const off = offloadToolResultIfNeeded(offloadCtx.config, item.result, {
          sessionId: offloadCtx.sessionId,
          runId: offloadCtx.runId,
          toolCallId: item.call.id,
          toolName: item.name,
          thresholdChars: offloadCtx.config.compact.toolResultOffload.thresholdChars,
        });
        if (off) {
          resultForLlm = off.llmResult;
          // 存盘路径留给 UI/审计；完整原文已在文件
          resultForStore = off.llmResult;
          if (off.artifact) {
            offloadCtx.onArtifact?.({
              ...off.artifact,
              toolCallId: item.call.id,
              toolName: item.name,
            });
          }
        }
      } catch (err) {
        console.warn(
          "[ReactLoop] tool result offload 失败，回退截断:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    executedTools.push({
      id: item.call.id,
      name: item.name,
      args: item.args,
      result: resultForStore,
      kind: item.kind ?? "tool",
    });
    // P2-04：截断时加显式 [TRUNCATED] 后缀，让 LLM 知道结果被裁，避免基于残缺 JSON 误判。
    // 优先截断 result 的 content/文本字段而非整个 JSON，保留结构完整性。
    const fullStr = JSON.stringify(resultForLlm);
    let content = fullStr;
    if (fullStr.length > maxChars) {
      const trimmed = truncateToolResultContent(resultForLlm, maxChars);
      content = trimmed ?? fullStr.slice(0, maxChars) + `\n...[TRUNCATED, original=${fullStr.length} chars, limit=${maxChars}]`;
    }
    // P2-04：工具结果不可信指令标记（defense-in-depth；单用户本地仍建议保留）
    content = markToolResultUntrusted(item.name, content);
    llmMessages.push({
      role: "tool",
      tool_call_id: item.call.id,
      name: item.name,
      content,
    });
  }
}

/** 给 LLM 侧 tool 消息加不可信标记：JSON 对象注入字段，否则行前缀 */
function markToolResultUntrusted(toolName: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return JSON.stringify({
          ...obj,
          _kp_untrusted_tool_result: true,
          _kp_tool: toolName,
        });
      }
    } catch {
      /* 非严格 JSON，走前缀 */
    }
  }
  return `[UNTRUSTED_TOOL_RESULT:${toolName}]\n${content}`;
}

/**
 * 将 Steering / Follow-up 注入 llmMessages，并尽量落库以便前端 message_upserted。
 * A8：有 session 且需留痕的 kind，落库失败 = 注入失败（不 push 进 LLM，禁幻影消息）。
 */
async function injectUserMessages(
  input: ReactLoopInput,
  llmMessages: LlmMessage[],
  items: Array<{ id: string; content: string }>,
  kind: "steer" | "follow_up" | "approval" | "ask_user",
): Promise<void> {
  for (const item of items) {
    let messageId: string | undefined;
    // ask_user 回复不落库为 user 气泡：工具本身挂起等待，回复（UI 手打或邮件回填）只作为
    // customResponse 填入弹框输入框 + 推给 LLM 续轮，不产生独立 user 气泡。
    // steer/follow_up/approval 仍落库（用户主动注入或审批决策需留痕）。
    const mustPersist = Boolean(input.sessionId) && kind !== "ask_user";
    let persisted = !mustPersist;
    if (mustPersist) {
      try {
        const created = await input.services.message.create({
          sessionId: input.sessionId!,
          role: "user",
          content: item.content,
          // 熔断/审批/steer 注入不是用户手打——source=system，避免气泡伪装成用户发言
          source: "system",
        } as Parameters<typeof input.services.message.create>[0]);
        if (created.success && created.data && typeof created.data === "object" && "id" in created.data) {
          messageId = String((created.data as { id: string }).id);
          persisted = true;
        } else {
          console.warn(`[ReactLoop] ${kind} 落库未成功，跳过 LLM 注入（A8）`);
        }
      } catch (err) {
        console.warn(`[ReactLoop] ${kind} 落库失败，跳过 LLM 注入（A8）:`, err instanceof Error ? err.message : err);
      }
    }
    if (!persisted) continue;
    llmMessages.push({ role: "user", content: item.content });
    input.hooks?.onInjected?.({ kind, content: item.content, messageId });
  }
}

export async function runReactLoop(input: ReactLoopInput): Promise<ReactLoopResult> {
  assertLlmBudget(input.config);
  const reserveEst = defaultLlmBudgetReserveEstimate(input.config);
  if (!tryReserveLlmBudget(input.config, reserveEst)) {
    throw new Error(
      "今日 LLM 预算预留失败（并发在途占用已达上限）。请稍候再试，或提高 LLM_DAILY_BUDGET。",
    );
  }
  try {
    return await runReactLoopInner(input);
  } finally {
    releaseLlmBudgetReservation(reserveEst);
  }
}

async function runReactLoopInner(input: ReactLoopInput): Promise<ReactLoopResult> {
  const effectiveModel = resolveEffectiveAgentModel(input.config, input.agent.model);
  const tierTools = resolveToolsForAgentTier(input.agentMeta?.tier, input.agent.tools);
  const parsed = parseAgentTools(tierTools);
  if (parsed.native === "all" && (input.agentMeta?.tier === "sub" || !input.agentMeta?.tier)) {
    parsed.native = DEFAULT_SUBAGENT_TOOLS.map((t) => t.replace(/^native:/, ""));
  }

  const snapshot: TurnSnapshot = {
    model: effectiveModel,
    tools: tierTools,
    maxRounds: input.config.llm.maxToolRounds,
    maxToolCalls: input.config.llm.maxToolCallsPerRun,
    toolResultMaxChars: input.toolResultMaxChars ?? AGENT_TOOL_RESULT_MAX_CHARS,
  };

  const machine = createPhaseMachine((to, from) => input.hooks?.onPhase?.(to, from));

  const registry = new Map<string, ToolRegistryEntry>();
  const toolSchemas = await buildAgentToolSchemas(input.services, parsed, registry);
  // W6：run 级 D 类工具回滚栈——本 run 执行的 destructive 工具在此记录，
  // run 进入 failed 且非用户 abort 时在 catch 中逆序补偿
  const rollbackStack = new RunRollbackStack();
  const toolCtx = createAgentToolContext(input.config, input.services, input.invokeTrpc, parsed, undefined, {
    sessionId: input.sessionId,
    agentSnapshot: input.agentMeta
      ? { ...input.agentMeta, tools: tierTools }
      : input.agentMeta,
    runOrigin: input.runOrigin ?? "user",
    rollbackStack,
    readonlyOnly: input.readonlyOnly === true,
  });

  let llmMessages: LlmMessage[] = [...input.messages];
  const executedTools: StoredToolCall[] = [];
  let totalUsage = { prompt: 0, completion: 0, total: 0 };
  let lastModel = snapshot.model;
  let lastProvider = input.config.llm.defaultProvider;
  let roundsUsed = 0;
  let toolCallsUsed = 0;
  let hitToolBudget = false;
  // W7：反思重修已消耗轮数（策略上限随 verdict.maxRounds 携带，消耗计数在本状态机内）
  let reflectionRoundsUsed = 0;
  let loopGuard = createLoopGuardState();
  /** 子会话血缘：用于 token 回记父会话 */
  let attributedParentSessionId: string | undefined;

  const accumulateUsage = (
    u?: { prompt: number; completion: number; total: number },
    model?: string,
  ) => {
    if (!u) return;
    totalUsage.prompt += u.prompt;
    totalUsage.completion += u.completion;
    totalUsage.total += u.total;
    recordTokenUsage(input.config, u, model ?? lastModel, {
      sessionId: input.sessionId,
      parentSessionId: attributedParentSessionId,
      agentId: input.agentMeta?.id,
      runId,
    });
  };

  // ── W11：Run 活状态——入口落 running 行，tool_batch 后节流快照，终态由内核统一 update ──
  // 落库是尽力而为的可观测性写路径：失败只告警，不得打断本次运行。
  const runStartedAt = Date.now();
  let runId: string | undefined;
  let lastRunSnapshotAt = 0;
  const countExecutedTools = () => executedTools.filter((t) => t.kind === "tool").length;
  const runSvc = input.services?.run;
  const canCreateRun = typeof runSvc?.create === "function";
  const canUpdateRun = typeof runSvc?.update === "function";

  if (canCreateRun) {
    try {
      const created = await runSvc.create({
        agentId: input.agentMeta?.id,
        sessionId: input.sessionId,
        status: "running",
        input: input.runInput ?? { runOrigin: input.runOrigin ?? "user" },
        output: { phase: "idle", roundsUsed: 0, executedToolsCount: 0 },
      });
      if (created.success && created.data && typeof created.data === "object" && "id" in created.data) {
        runId = String((created.data as { id: string }).id);
      }
    } catch (err) {
      console.warn("[ReactLoop] running Run 落库失败（不影响本次运行）:", err instanceof Error ? err.message : err);
    }
  }

  // 子会话 token 回记父会话（DeerFlow 子 Agent 用量归因）
  if (input.sessionId && input.services?.session) {
    try {
      const sess =
        (await input.services.session.getByIdLite?.(input.sessionId)) ??
        (await input.services.session.getById(input.sessionId));
      const pid = (sess as { parentSessionId?: string | null } | null)?.parentSessionId;
      if (pid) attributedParentSessionId = pid;
    } catch {
      /* 归因失败不阻断 */
    }
  }

  /** tool_batch 结束后节流快照 { phase, roundsUsed, executedToolsCount }；phase 转移点（如 awaiting_human）强制写 */
  const writeRunSnapshot = async (force = false) => {
    if (!runId || !canUpdateRun || !runSvc) return;
    const now = Date.now();
    if (!force && now - lastRunSnapshotAt < RUN_SNAPSHOT_THROTTLE_MS) return;
    lastRunSnapshotAt = now;
    const executedToolsCount = countExecutedTools();
    const toolOnly = executedTools.filter((t) => t.kind === "tool");
    const lastTool = [...toolOnly].reverse()[0];
    const lastToolName =
      lastTool && typeof (lastTool as { name?: string }).name === "string"
        ? String((lastTool as { name: string }).name)
        : undefined;
    // P1-03：最近工具名摘要（复盘/导出用；不含 args/正文）
    const recentToolNames = toolOnly
      .slice(-8)
      .map((t) => (typeof (t as { name?: string }).name === "string" ? String((t as { name: string }).name) : "?"))
      .filter(Boolean);
    const output = {
      phase: machine.phase,
      roundsUsed,
      executedToolsCount,
      ...(lastToolName ? { lastToolName } : {}),
      ...(recentToolNames.length ? { recentToolNames } : {}),
    };
    try {
      await runSvc.update({
        id: runId,
        output,
      });
    } catch (err) {
      console.warn("[ReactLoop] Run 快照写回失败:", err instanceof Error ? err.message : err);
    }
    // 子会话进度透传父会话（仅元信息，不泄正文）
    if (input.sessionId && input.services?.session) {
      try {
        const sess =
          (await input.services.session.getByIdLite?.(input.sessionId)) ??
          (await input.services.session.getById(input.sessionId));
        const parentSessionId = (sess as { parentSessionId?: string | null } | null)?.parentSessionId;
        if (parentSessionId) {
          const { notifySubagentSessionUpdate } = await import("../asyncJobManager.js");
          await notifySubagentSessionUpdate({
            parentSessionId,
            subagentSessionId: input.sessionId,
            status: "running",
            agentId: input.agentMeta?.id ?? null,
            progress: {
              phase: machine.phase,
              roundsUsed,
              executedToolsCount,
              lastToolName,
            },
          });
        }
      } catch {
        /* 进度推送失败不阻断主循环 */
      }
    }
  };

  /** 终态统一收口：success / failed / cancelled（用户 abort），output 携带 phase 终态快照与业务字段 */
  const finalizeRun = async (terminal: "success" | "failed" | "cancelled", patch: Record<string, unknown>) => {
    // W5 + P1-02：无产出 run 的 token 记入 wastedTokens（日预算已在 accumulateUsage 扣过）。
    // 原 W5 仅对 heartbeat/async origin + success 终态 + 零工具统计；P1-02 扩展到所有 origin 的
    // 预算/轮次耗尽兜底（terminal=failed 且 hitToolBudget 或 maxRounds 耗尽）——这些 token 也是"白烧"。
    const origin = input.runOrigin ?? "user";
    const isBudgetExhausted = terminal === "failed" && (patch?.hitToolBudget === true || patch?.roundsExhausted === true);
    if (
      totalUsage.total > 0 &&
      countExecutedTools() === 0 &&
      ((origin === "heartbeat" || origin === "async") && terminal === "success"
        ? true
        : isBudgetExhausted)
    ) {
      markTokensWasted(input.config, totalUsage.total);
    }
    if (!runId || !canUpdateRun || !runSvc) return;
    // 不变量：aborted 时唯一合法终态 cancelled——拒绝 success 收口
    let effective: "success" | "failed" | "cancelled" = terminal;
    if (terminal === "success" && input.signal?.aborted === true) {
      console.error(`${formatTrace()}[ReactLoop] 拒绝 aborted run 以 success 收口，强制 cancelled`);
      effective = "cancelled";
    }
    try {
      await runSvc.update({
        id: runId,
        status: effective,
        output: { ...patch, phase: machine.phase, roundsUsed, executedToolsCount: countExecutedTools() },
        toolCalls: executedTools,
        tokenUsage: totalUsage,
        durationMs: Date.now() - runStartedAt,
        toolCallCount: countExecutedTools(),
      });
      // PUSH：/runs 与开着的 Chat 立刻对齐终态（推拉铁律）
      try {
        const { notifyAllMainSessionsUi, pushUiStateToSession } = await import("../uiStateNotify.js");
        const ev = {
          type: "run_updated" as const,
          runId,
          sessionId: input.sessionId,
          status: effective,
          phase: machine.phase,
        };
        if (input.sessionId) pushUiStateToSession(input.sessionId, ev);
        await notifyAllMainSessionsUi(input.services.prisma, ev);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.warn(`${formatTrace()}[ReactLoop] Run 终态写回失败:`, err instanceof Error ? err.message : err);
    }
  };

  try {
    machine.transition("compacting");

    let existingSummary: string | null = null;
    let existingGeneration = 0;
    if (input.sessionId) {
      try {
        const sess =
          (await input.services.session.getByIdLite?.(input.sessionId)) ??
          (await input.services.session.getById(input.sessionId));
        existingSummary = (sess as { contextSummary?: string | null } | null)?.contextSummary ?? null;
        existingGeneration =
          (sess as { compactGeneration?: number | null } | null)?.compactGeneration ?? 0;
      } catch {
        /* ignore */
      }
    }

    const compacted = await maybeCompactMessages(input.config, llmMessages, snapshot.model, {
      existingSummary,
      existingGeneration,
      flushContext: input.sessionId
        ? {
            services: input.services,
            sessionId: input.sessionId,
            agentId: input.agentMeta?.id,
            workspaceId: input.agentMeta?.workspaceId,
            tier: input.agentMeta?.tier,
          }
        : undefined,
      emit: input.compactEmit,
    });
    llmMessages = compacted.messages;
    if (compacted.compacted) {
      console.log("[Agent] 长对话已自动压缩上下文");
      if (compacted.summaryText && input.sessionId && !compacted.reused) {
        try {
          await persistCompactResult(input.services, input.sessionId, compacted, {
            trigger: "auto",
            emit: input.compactEmit,
          });
          if (compacted.summaryText) existingSummary = compacted.summaryText;
          if (compacted.generation != null) existingGeneration = compacted.generation;
        } catch (err) {
          console.warn("[AutoCompact] 持久化摘要失败:", err instanceof Error ? err.message : err);
        }
      }
    }

    /** W5：overflow 时压缩一次（复用同一 CAS 路径），供 completeWithOverflowCompact 调用 */
    const compactOnceForOverflow = async (): Promise<{ didCompact: boolean }> => {
      let gen = existingGeneration;
      let summary = existingSummary;
      if (input.sessionId) {
        try {
          const sess =
            (await input.services.session.getByIdLite?.(input.sessionId)) ??
            (await input.services.session.getById(input.sessionId));
          summary = (sess as { contextSummary?: string | null } | null)?.contextSummary ?? summary;
          gen = (sess as { compactGeneration?: number | null } | null)?.compactGeneration ?? gen;
        } catch {
          /* ignore */
        }
      }
      const overflowCompacted = await maybeCompactMessages(input.config, llmMessages, snapshot.model, {
        existingSummary: summary,
        existingGeneration: gen,
        flushContext: input.sessionId
          ? {
              services: input.services,
              sessionId: input.sessionId,
              agentId: input.agentMeta?.id,
              workspaceId: input.agentMeta?.workspaceId,
              tier: input.agentMeta?.tier,
            }
          : undefined,
        emit: input.compactEmit,
      });
      llmMessages = overflowCompacted.messages;
      if (overflowCompacted.compacted && overflowCompacted.summaryText && input.sessionId && !overflowCompacted.reused) {
        try {
          await persistCompactResult(input.services, input.sessionId, overflowCompacted, {
            trigger: "auto",
            emit: input.compactEmit,
          });
          existingSummary = overflowCompacted.summaryText;
          if (overflowCompacted.generation != null) existingGeneration = overflowCompacted.generation;
        } catch (err) {
          console.warn("[AutoCompact] overflow 恢复持久化失败:", err instanceof Error ? err.message : err);
        }
      }
      return { didCompact: !!(overflowCompacted.compacted && !overflowCompacted.reused) };
    };

    machine.transition("llm");

    // P3-02：反思重修不占用工具轮预算——每回注一次加 1 个 bonus 迭代上限
    let reflectionBonusRounds = 0;
    for (let round = 0; round < snapshot.maxRounds + reflectionBonusRounds; round++) {
      roundsUsed = round + 1;
      input.hooks?.onRoundStart?.(roundsUsed);

      // P1：上下文重置已并入 autoCompact 的降级路径（摘要失败/不可用时走 contextReset）。
      // 此处不再每轮重复触发，避免与 autoCompact 重复裁剪。

      if (machine.phase !== "llm") {
        machine.transition("llm");
      }

      if (input.signal?.aborted) {
        throw makeAbortError(input.signal);
      }

      llmMessages = await applyContextHooksBeforeComplete(
        input,
        toolCtx,
        llmMessages,
        roundsUsed,
        runId,
      );

      // W5：overflow → 压缩一次 → 同请求重试一次（钩子链保留 W4，仅包 transport.complete）
      const turn = await completeWithOverflowCompact({
        complete: () =>
          input.transport.complete({
            messages: llmMessages,
            tools: toolSchemas,
            signal: input.signal,
            withTools: true,
          }),
        compactOnce: compactOnceForOverflow,
      });

      lastModel = turn.model || lastModel;
      lastProvider = turn.provider || lastProvider;
      accumulateUsage(turn.tokenUsage, lastModel);

      if (turn.reasoningContent) {
        pushThinking(executedTools, roundsUsed, turn.reasoningContent);
        // sync 路径 transport 不会调 onThinking；补一次整段
        if (!input.hooks?.onToken) {
          input.hooks?.onThinking?.(roundsUsed, turn.reasoningContent);
        }
      }

      if (!turn.toolCalls.length) {
        // BEFORE_STOP：Follow-up 注入后续轮（同 run，phase 保持 llm）
        const followUps = input.runQueues?.takeFollowUp() ?? [];
        if (followUps.length > 0) {
          // 若本轮已有正文，先记入时间线，再注入 follow-up 继续
          if (turn.content?.trim()) {
            pushIntermediateContent(executedTools, roundsUsed, turn.content);
            input.hooks?.onIntermediateContent?.(roundsUsed, turn.content);
          }
          llmMessages.push({
            role: "assistant",
            content: turn.content,
            reasoning_content: turn.reasoningContent ?? null,
          });
          await injectUserMessages(input, llmMessages, followUps, "follow_up");
          // A5：注入成功后 ack 持久队列行，避免收尾误移交
          if (input.sessionId) {
            await getStreamHub()?.ackInject(
              input.sessionId,
              followUps.map((f) => f.id),
            );
          }
          continue;
        }

        // W7 反思：withReflection 附着的 critic verdict 在 done 转移点消费。
        // 决策（重试/放行）只发生在这里——transport 层只评估，不持有状态机。
        const reflection = turn.reflection;
        if (reflection && !reflection.passed && reflectionRoundsUsed < reflection.maxRounds) {
          reflectionRoundsUsed++;
          // 被拒终稿先记入时间线，再经既有 injectUserMessages 显式机制回注，loop 再走一轮
          if (turn.content?.trim()) {
            pushIntermediateContent(executedTools, roundsUsed, turn.content);
            input.hooks?.onIntermediateContent?.(roundsUsed, turn.content);
          }
          llmMessages.push({
            role: "assistant",
            content: turn.content,
            reasoning_content: turn.reasoningContent ?? null,
          });
          // verdict 消费显式事件（在回注前发出：时间线上反思条目先于回注气泡出现）
          input.hooks?.onReflection?.({ round: roundsUsed, issues: reflection.issues, action: "retry" });
          await injectUserMessages(
            input,
            llmMessages,
            [{ id: `reflection_${reflectionRoundsUsed}`, content: reflection.feedback }],
            "follow_up",
          );
          input.hooks?.onProgress?.(
            `反思复核未通过，已回注重修（第 ${reflectionRoundsUsed}/${reflection.maxRounds} 轮）`,
          );
          reflectionBonusRounds++;
          continue;
        }

        let content = sanitizePostCompactAssistantContent(turn.content || "", executedTools);
        // 反思轮数耗尽仍未通过：带标记放行，不阻断用户
        if (reflection && !reflection.passed) {
          content = REFLECTION_UNPASSED_MARK + content;
          input.hooks?.onReflection?.({ round: roundsUsed, issues: reflection.issues, action: "marked" });
          input.hooks?.onProgress?.("反思重修轮数已耗尽，内容未经反思通过，标记放行");
        }
        machine.transition("done");
        await finalizeRun("success", { content });
        return {
          content,
          toolCalls: executedTools,
          tokenUsage: totalUsage,
          model: lastModel,
          provider: lastProvider,
          roundsUsed,
          phase: machine.phase,
          hitToolBudget: false,
          runId,
        };
      }

      if (turn.content?.trim()) {
        pushIntermediateContent(executedTools, roundsUsed, turn.content);
        input.hooks?.onIntermediateContent?.(roundsUsed, turn.content);
      }

      llmMessages.push({
        role: "assistant",
        content: turn.content,
        reasoning_content: turn.reasoningContent ?? null,
        tool_calls: turn.toolCalls,
      });

      machine.transition("tool_batch");

      // DeerFlow：ask_user 链尾门禁——同批若含 ask_user，只执行 ask_user，其余本批跳过
      const parsedPreview = turn.toolCalls.map((c) => ({ call: c, ...parseToolCall(c) }));
      const askUserCalls = parsedPreview.filter(
        (p) => p.name === "ask_user" || p.name === "native:ask_user",
      );
      let callsForBudget = turn.toolCalls;
      const askUserGateSkipped: typeof parsedPreview = [];
      if (askUserCalls.length > 0 && parsedPreview.length > askUserCalls.length) {
        callsForBudget = askUserCalls.map((p) => p.call);
        for (const p of parsedPreview) {
          if (p.name !== "ask_user" && p.name !== "native:ask_user") {
            askUserGateSkipped.push(p);
          }
        }
      }

      // DeerFlow LoopDetection：同参连续工具调用熔断
      const loopVerdict = checkToolLoop(
        loopGuard,
        parsedPreview.map((p) => ({ name: p.name, args: p.args })),
        input.config.compact.toolLoopStreakLimit,
      );
      loopGuard = loopVerdict.state;
      if (loopVerdict.blocked) {
        // 已 push 带 tool_calls 的 assistant → 必须补齐 tool 消息，再 follow_up
        const blockItems = parsedPreview.map((p) => ({
          call: p.call,
          name: p.name,
          args: p.args,
          result: {
            error: "TOOL_LOOP_BLOCKED",
            message: loopVerdict.message,
            fingerprint: loopVerdict.fingerprint,
          },
          kind: "tool" as const,
        }));
        appendToolResultMessages(
          llmMessages,
          executedTools,
          blockItems,
          snapshot.toolResultMaxChars,
        );
        await injectUserMessages(
          input,
          llmMessages,
          [{ id: `loop-guard-${roundsUsed}`, content: loopVerdict.message }],
          "follow_up",
        );
        input.hooks?.onProgress?.(`工具死循环熔断：${loopVerdict.fingerprint.slice(0, 80)}`);
        machine.transition("llm");
        continue;
      }

      const { runnable, deferred } = partitionToolCallsByBudget(
        callsForBudget,
        toolCallsUsed,
        snapshot.maxToolCalls,
      );

      for (const call of [...runnable, ...deferred]) {
        const parsedCall = parseToolCall(call);
        input.hooks?.onToolStart?.({
          toolCallId: call.id,
          name: parsedCall.name,
          args: parsedCall.args,
          round: roundsUsed,
        });
      }

      if (input.signal?.aborted) {
        throw makeAbortError(input.signal);
      }

      toolCtx.inToolRound = true;
      const batchResults = runnable.length
        ? await executeToolCallsBatch(runnable, toolCtx, registry, parsed, input.signal)
        : [];
      toolCtx.inToolRound = false;

      const offloadAppend = {
        config: input.config,
        sessionId: input.sessionId,
        runId,
        onArtifact: (a: {
          type: string;
          title?: string;
          path: string;
          mime?: string;
          toolCallId: string;
          toolName: string;
        }) => {
          const sid = input.sessionId;
          if (!sid) return;
          try {
            const hub = getStreamHub();
            hub?.pushExternalEvent(sid, {
              type: "artifact_created",
              sessionId: sid,
              artifactKind: a.type,
              title: a.title,
              path: a.path,
              mime: a.mime,
              toolCallId: a.toolCallId,
              toolName: a.toolName,
            });
          } catch {
            /* ignore */
          }
        },
      };

      const executedItems = batchResults.map(({ call, parsed: p, result }) => ({
        call,
        name: p.name,
        args: p.args,
        result,
        kind: "tool" as const,
      }));
      appendToolResultMessages(
        llmMessages,
        executedTools,
        executedItems,
        snapshot.toolResultMaxChars,
        offloadAppend,
      );
      for (const item of executedItems) {
        input.hooks?.onToolEnd?.({
          toolCallId: item.call.id,
          name: item.name,
          result: item.result,
          round: roundsUsed,
        });
      }

      const deferredItems = deferred.map((call) => {
        const p = parseToolCall(call);
        return {
          call,
          name: p.name,
          args: p.args,
          result: TOOL_BUDGET_SKIP_RESULT,
          kind: "tool" as const,
        };
      });
      // ask_user 门禁跳过的同批工具：明确回写，避免模型以为已执行
      const askGateItems = askUserGateSkipped.map((p) => ({
        call: p.call,
        name: p.name,
        args: p.args,
        result: {
          skipped: true,
          reason: "ask_user_last_gate",
          hint: "同批含 ask_user 时仅执行澄清；其它工具已跳过，用户答复后续轮再调。",
        },
        kind: "tool" as const,
      }));
      appendToolResultMessages(
        llmMessages,
        executedTools,
        [...deferredItems, ...askGateItems],
        snapshot.toolResultMaxChars,
        offloadAppend,
      );
      for (const item of [...deferredItems, ...askGateItems]) {
        input.hooks?.onToolEnd?.({
          toolCallId: item.call.id,
          name: item.name,
          result: item.result,
          round: roundsUsed,
        });
      }

      toolCallsUsed += runnable.length;
      input.hooks?.onProgress?.(
        `第 ${roundsUsed} 轮工具调用完成，执行 ${batchResults.length} 个` +
          (deferred.length ? `，预算跳过 ${deferred.length} 个` : ""),
      );

      // W11：每轮 tool_batch 结束后写活状态快照（节流：RUN_SNAPSHOT_THROTTLE_MS 内至多一次）
      await writeRunSnapshot();

      if (toolCallsUsed >= snapshot.maxToolCalls) {
        hitToolBudget = true;
        machine.transition("synthesizing");
        break;
      }

      // W11 HITL：本批有工具触发审批 pending → 挂起（tool_batch → awaiting_human），
      // 等 approval_resolved 显式事件唤醒后回 llm。唤醒靠事件不靠轮询；注入复用 W7 injectUserMessages。
      const pendingApprovals = executedItems
        .map((item) => readApprovalPendingMarker(item.result))
        .filter(
          (m): m is { approvalId: string; toolName?: string; decisionScope?: string } => m !== null,
        );
      if (pendingApprovals.length > 0) {
        machine.transition("awaiting_human");
        const blockedScopes = pendingApprovals
          .map((m) => m.decisionScope)
          .filter((s): s is string => typeof s === "string" && s.length > 0);
        // 挂起态必须可查：phase=awaiting_human + 被堵 scope（W3 UI）
        await writeRunSnapshot(true);
        try {
          if (runId && blockedScopes.length > 0) {
            await input.services.prisma.run.update({
              where: { id: runId },
              data: {
                output: {
                  phase: "awaiting_human",
                  roundsUsed,
                  executedToolsCount: countExecutedTools(),
                  blockedScopes,
                  pendingApprovalIds: pendingApprovals.map((m) => m.approvalId),
                },
              },
            });
          }
        } catch {
          /* 快照增强失败不阻断挂起 */
        }
        input.hooks?.onProgress?.(
          `等待人工审批（${pendingApprovals.map((m) => m.approvalId).join(", ")}${
            blockedScopes.length ? `；scope ${blockedScopes.join(", ")}` : ""
          }），运行已挂起`,
        );
        for (const pending of pendingApprovals) {
          const resolution = await waitApprovalResolution(input.services, pending.approvalId, {
            signal: input.signal,
          });
          await injectUserMessages(
            input,
            llmMessages,
            [{ id: `approval_${pending.approvalId}`, content: buildApprovalResumeMessage(resolution) }],
            "approval",
          );
        }
        // 落入迭代末尾统一 machine.transition("llm")——awaiting_human → llm 合法转移
      }

      // ask_user：工具返回 askUserPending → 同 phase 挂起，等 UI/邮件 resolve
      const pendingAsks = executedItems
        .map((item) => {
          const m = readAskUserPendingMarker(item.result);
          return m ? { askId: m.askId, toolCallId: item.call.id } : null;
        })
        .filter((m): m is { askId: string; toolCallId: string } => m !== null);
      if (pendingAsks.length > 0) {
        if (machine.phase !== "awaiting_human") {
          machine.transition("awaiting_human");
          await writeRunSnapshot(true);
        }
        input.hooks?.onProgress?.(
          `等待用户答复 ask_user（${pendingAsks.map((m) => m.askId).join(", ")}），运行已挂起`,
        );
        for (const pending of pendingAsks) {
          const resolution: AskUserResolution = await waitAskUserResolution(pending.askId, {
            signal: input.signal,
          });
          if (input.sessionId) {
            getStreamHub()?.pushExternalEvent(input.sessionId, {
              type: "ask_user_resolved",
              sessionId: input.sessionId,
              askId: pending.askId,
              outcome: resolution.outcome,
              answer: resolution.outcome === "answered" ? resolution.answer : undefined,
            });
          }
          // 把用户答复回写到工具调用结果：前端工具框（ToolStep.result）即可显示用户回复，
          // 历史加载也一致（tool result 携带 answer，不再只是 waiting_for_user 占位）。
          const askTool = executedTools.find((t) => t.id === pending.toolCallId);
          const resolvedResult = {
            success: true,
            status: resolution.outcome,
            askId: resolution.askId,
            answer: resolution.outcome === "answered" ? resolution.answer : undefined,
            source: resolution.source,
          };
          if (askTool) {
            askTool.result = resolvedResult;
            // 同步更新 llmMessages 里对应 tool message 的 content，保持当前轮与历史加载一致
            const toolMsg = llmMessages.find(
              (m): m is { role: "tool"; tool_call_id: string; content: string } =>
                m.role === "tool" && (m as { tool_call_id?: string }).tool_call_id === pending.toolCallId,
            );
            if (toolMsg) toolMsg.content = JSON.stringify(resolvedResult);
          }
          await injectUserMessages(
            input,
            llmMessages,
            [{ id: `ask_user_${pending.askId}`, content: buildAskUserResumeMessage(resolution) }],
            "ask_user",
          );
        }
      }

      // AFTER_TOOL_BATCH：Steering 注入后再进入下一轮 LLM
      const steers = input.runQueues?.takeSteer() ?? [];
      if (steers.length > 0) {
        await injectUserMessages(input, llmMessages, steers, "steer");
        // A5：注入成功后 ack；若此处之后 abort，已 ack 的不再移交
        if (input.sessionId) {
          await getStreamHub()?.ackInject(
            input.sessionId,
            steers.map((s) => s.id),
          );
        }
      }

      // 下一轮 LLM
      machine.transition("llm");
    }

    // maxRounds 耗尽且未因预算进入 synthesizing
    if (machine.phase === "llm" || machine.phase === "tool_batch") {
      machine.transition("synthesizing");
    }

    if (machine.phase === "synthesizing") {
      // aborted 不得以兜底文案 success 收口——唯一合法终态 cancelled（外层 catch）
      if (input.signal?.aborted) {
        throw makeAbortError(input.signal);
      }
      const hasToolWork = executedTools.some(
        (t) => t.name !== "__thinking__" && t.name !== "__content__",
      );
      let synthesisFailedMsg: string | null = null;
      if (hasToolWork) {
        try {
          llmMessages = await applyContextHooksBeforeComplete(
            input,
            toolCtx,
            llmMessages,
            roundsUsed || 1,
            runId,
          );
          const synthesis = await completeWithOverflowCompact({
            complete: () =>
              input.transport.complete({
                messages: llmMessages,
                signal: input.signal,
                withTools: false,
              }),
            compactOnce: compactOnceForOverflow,
          });
          if (input.signal?.aborted) {
            throw makeAbortError(input.signal);
          }
          if (synthesis.model) lastModel = synthesis.model;
          if (synthesis.provider) lastProvider = synthesis.provider;
          accumulateUsage(synthesis.tokenUsage, lastModel);
          if (synthesis.reasoningContent) {
            pushThinking(executedTools, roundsUsed || 1, synthesis.reasoningContent);
          }
          if (synthesis.content?.trim()) {
            machine.transition("done");
            const finalContent = sanitizePostCompactAssistantContent(synthesis.content, executedTools);
            await finalizeRun("success", { content: finalContent });
            return {
              content: finalContent,
              toolCalls: executedTools,
              tokenUsage: totalUsage,
              model: lastModel,
              provider: lastProvider,
              roundsUsed,
              phase: machine.phase,
              hitToolBudget,
              runId,
            };
          }
        } catch (err) {
          // AbortError 必须重抛中断；其他合成失败落真实错误文案（禁止伪装成预算耗尽）
          if (isAbortLikeError(err) || input.signal?.aborted) {
            throw isAbortLikeError(err) ? err : makeAbortError(input.signal);
          }
          synthesisFailedMsg = err instanceof Error ? err.message : String(err);
          console.warn(
            `${formatTrace()}[reactLoop] synthesizing 失败（不伪装预算耗尽）:`,
            synthesisFailedMsg,
          );
        }
      }

      if (input.signal?.aborted) {
        throw makeAbortError(input.signal);
      }

      const fallback = synthesisFailedMsg
        ? `合成最终回复失败：${synthesisFailedMsg}`
        : hitToolBudget
          ? `已达到单次运行工具调用上限（${snapshot.maxToolCalls}）。可通过环境变量 AGENT_MAX_TOOL_CALLS_PER_RUN 调整。`
          : `已达到最大工具调用轮次（${snapshot.maxRounds}）。可通过环境变量 AGENT_MAX_TOOL_ROUNDS 调整上限。`;
      // 流式：兜底文案也推给前端
      input.hooks?.onToken?.(fallback);
      machine.transition("done");
      // P1-02：预算/轮次耗尽是异常终止（非正常完成），改记 failed 而非 success——
      // 避免监控/账本低估失败率；wastedTokens 在 finalizeRun 内按 hitToolBudget/roundsExhausted 标记统计。
      await finalizeRun("failed", {
        content: fallback,
        hitToolBudget,
        roundsExhausted: !hitToolBudget && !synthesisFailedMsg,
        synthesisFailed: !!synthesisFailedMsg,
      });
      return {
        content: fallback,
        toolCalls: executedTools,
        tokenUsage: totalUsage,
        model: lastModel,
        provider: lastProvider,
        roundsUsed: hitToolBudget ? roundsUsed : snapshot.maxRounds,
        phase: machine.phase,
        hitToolBudget,
        runId,
      };
    }

    machine.transition("done");
    await finalizeRun("success", { content: "" });
    return {
      content: "",
      toolCalls: executedTools,
      tokenUsage: totalUsage,
      model: lastModel,
      provider: lastProvider,
      roundsUsed,
      phase: machine.phase,
      hitToolBudget,
      runId,
    };
  } catch (err) {
    try {
      if (machine.phase !== "failed" && machine.phase !== "done") {
        machine.transition("failed");
      }
    } catch {
      /* phase 已终态 */
    }

    // W6：D 类工具补偿——run 进入 failed 且非用户 abort 时逆序回滚本 run 已执行的写入工具。
    // 回滚报告挂在错误对象上供上层（agentStream/agentRuntime）透传，并写入 failed Run 的
    // output.rollback（W11：终态由 finalizeRun 统一 update 到入口创建的 running 行）。
    const isAbort = input.signal?.aborted === true || isAbortLikeError(err);
    let report: RunRollbackReport | null = null;
    if (!isAbort) {
      try {
        report = await rollbackStack.rollbackAll(toolCtx);
      } catch (rbErr) {
        console.warn("[ReactLoop] 回滚栈执行异常:", rbErr instanceof Error ? rbErr.message : rbErr);
      }
      if (report) {
        (err as Error & { rollbackReport?: RunRollbackReport }).rollbackReport = report;
        input.hooks?.onProgress?.(
          `运行失败：已回滚 ${report.rolledBack} 个写入操作` +
            (report.warned > 0 ? `，${report.warned} 个不可逆操作需人工 revert/检查` : "") +
            (report.failed > 0 ? `，${report.failed} 个回滚失败需人工处理` : ""),
        );
      }
    }
    // W11：终态收口——abort 标 cancelled，其余标 failed；回滚报告并入 output
    await finalizeRun(isAbort ? "cancelled" : "failed", {
      error: err instanceof Error ? err.message : String(err),
      ...(report ? { rollback: report } : {}),
    });
    throw err;
  }
}
