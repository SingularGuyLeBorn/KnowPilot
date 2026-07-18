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
import { assertLlmBudget, recordTokenUsage } from "../llmBudget.js";
import { maybeCompactMessages, persistCompactResult } from "../autoCompact.js";
import { sanitizePostCompactAssistantContent, type StoredToolCall } from "../chatHistory.js";
import { RunRollbackStack, type RunRollbackReport } from "../tools/rollback.js";
import { waitApprovalResolution, type ApprovalResolution } from "../approvalGate.js";
import {
  DEFAULT_SUBAGENT_TOOLS,
  resolveToolsForAgentTier,
  parseToolCall,
} from "./setup.js";
import { AGENT_TOOL_RESULT_MAX_CHARS } from "@knowpilot/shared";
import { createPhaseMachine } from "./phase.js";
import { REFLECTION_UNPASSED_MARK } from "./reflection.js";
import type { ReactLoopInput, ReactLoopResult, TurnSnapshot } from "./types.js";
import { makeAbortError } from "../abortReason.js";

/** W11：Run.output 活状态快照写回节流间隔（每轮 tool_batch 后至多写一次） */
const RUN_SNAPSHOT_THROTTLE_MS = 5000;

/** W11：审批执行结果注入消息的最大长度（超出截断，防爆上下文） */
const APPROVAL_RESULT_MAX_CHARS = 2000;

/** W11：从工具结果中读取审批 pending 标记（agentTools runOne 捕获 PENDING_APPROVAL 时写入） */
function readApprovalPendingMarker(result: unknown): { approvalId: string; toolName?: string } | null {
  if (!result || typeof result !== "object") return null;
  const marker = (result as { approvalPending?: unknown }).approvalPending;
  if (
    marker &&
    typeof marker === "object" &&
    typeof (marker as { approvalId?: unknown }).approvalId === "string"
  ) {
    return marker as { approvalId: string; toolName?: string };
  }
  return null;
}

function truncateForMessage(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > APPROVAL_RESULT_MAX_CHARS ? `${text.slice(0, APPROVAL_RESULT_MAX_CHARS)}…` : text;
}

/** W11：审批决策后的续跑注入消息（经 injectUserMessages 显式机制进入原 session 与 llmMessages） */
function buildApprovalResumeMessage(resolution: ApprovalResolution): string {
  const base = `approvalId=${resolution.approvalId}，操作：${resolution.toolName}`;
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
) {
  for (const item of items) {
    executedTools.push({
      id: item.call.id,
      name: item.name,
      args: item.args,
      result: item.result,
      kind: item.kind ?? "tool",
    });
    llmMessages.push({
      role: "tool",
      tool_call_id: item.call.id,
      name: item.name,
      content: JSON.stringify(item.result).slice(0, maxChars),
    });
  }
}

/** 将 Steering / Follow-up 注入 llmMessages，并尽量落库以便前端 message_upserted */
async function injectUserMessages(
  input: ReactLoopInput,
  llmMessages: LlmMessage[],
  items: Array<{ id: string; content: string }>,
  kind: "steer" | "follow_up" | "approval",
): Promise<void> {
  for (const item of items) {
    let messageId: string | undefined;
    if (input.sessionId) {
      try {
        const created = await input.services.message.create({
          sessionId: input.sessionId,
          role: "user",
          content: item.content,
          // 元数据供 UI 识别来源（若 schema 不收 meta 则忽略）
        } as Parameters<typeof input.services.message.create>[0]);
        if (created.success && created.data && typeof created.data === "object" && "id" in created.data) {
          messageId = String((created.data as { id: string }).id);
        }
      } catch (err) {
        console.warn(`[ReactLoop] ${kind} 落库失败:`, err instanceof Error ? err.message : err);
      }
    }
    llmMessages.push({ role: "user", content: item.content });
    input.hooks?.onInjected?.({ kind, content: item.content, messageId });
  }
}

export async function runReactLoop(input: ReactLoopInput): Promise<ReactLoopResult> {
  assertLlmBudget(input.config);

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

  const accumulateUsage = (u?: { prompt: number; completion: number; total: number }) => {
    if (!u) return;
    totalUsage.prompt += u.prompt;
    totalUsage.completion += u.completion;
    totalUsage.total += u.total;
    recordTokenUsage(input.config, u);
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

  /** tool_batch 结束后节流快照 { phase, roundsUsed, executedToolsCount }；phase 转移点（如 awaiting_human）强制写 */
  const writeRunSnapshot = async (force = false) => {
    if (!runId || !canUpdateRun || !runSvc) return;
    const now = Date.now();
    if (!force && now - lastRunSnapshotAt < RUN_SNAPSHOT_THROTTLE_MS) return;
    lastRunSnapshotAt = now;
    try {
      await runSvc.update({
        id: runId,
        output: { phase: machine.phase, roundsUsed, executedToolsCount: countExecutedTools() },
      });
    } catch (err) {
      console.warn("[ReactLoop] Run 快照写回失败:", err instanceof Error ? err.message : err);
    }
  };

  /** 终态统一收口：success / failed / cancelled（用户 abort），output 携带 phase 终态快照与业务字段 */
  const finalizeRun = async (terminal: "success" | "failed" | "cancelled", patch: Record<string, unknown>) => {
    if (!runId || !canUpdateRun || !runSvc) return;
    try {
      await runSvc.update({
        id: runId,
        status: terminal,
        output: { ...patch, phase: machine.phase, roundsUsed, executedToolsCount: countExecutedTools() },
        toolCalls: executedTools,
        tokenUsage: totalUsage,
        durationMs: Date.now() - runStartedAt,
        toolCallCount: countExecutedTools(),
      });
    } catch (err) {
      console.warn("[ReactLoop] Run 终态写回失败:", err instanceof Error ? err.message : err);
    }
  };

  try {
    machine.transition("compacting");

    let existingSummary: string | null = null;
    if (input.sessionId) {
      try {
        const sess =
          (await input.services.session.getByIdLite?.(input.sessionId)) ??
          (await input.services.session.getById(input.sessionId));
        existingSummary = (sess as { contextSummary?: string | null } | null)?.contextSummary ?? null;
      } catch {
        /* ignore */
      }
    }

    const compacted = await maybeCompactMessages(input.config, llmMessages, snapshot.model, {
      existingSummary,
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
        } catch (err) {
          console.warn("[AutoCompact] 持久化摘要失败:", err instanceof Error ? err.message : err);
        }
      }
    }

    machine.transition("llm");

    for (let round = 0; round < snapshot.maxRounds; round++) {
      roundsUsed = round + 1;
      input.hooks?.onRoundStart?.(roundsUsed);

      if (machine.phase !== "llm") {
        machine.transition("llm");
      }

      if (input.signal?.aborted) {
        throw makeAbortError(input.signal);
      }

      const turn = await input.transport.complete({
        messages: llmMessages,
        tools: toolSchemas,
        signal: input.signal,
        withTools: true,
      });

      lastModel = turn.model || lastModel;
      lastProvider = turn.provider || lastProvider;
      accumulateUsage(turn.tokenUsage);

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

      if (toolCallsUsed >= snapshot.maxToolCalls) {
        hitToolBudget = true;
        machine.transition("synthesizing");
        break;
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

      const { runnable, deferred } = partitionToolCallsByBudget(
        turn.toolCalls,
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

      const executedItems = batchResults.map(({ call, parsed: p, result }) => ({
        call,
        name: p.name,
        args: p.args,
        result,
        kind: "tool" as const,
      }));
      appendToolResultMessages(llmMessages, executedTools, executedItems, snapshot.toolResultMaxChars);
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
      appendToolResultMessages(llmMessages, executedTools, deferredItems, snapshot.toolResultMaxChars);
      for (const item of deferredItems) {
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
        .filter((m): m is { approvalId: string; toolName?: string } => m !== null);
      if (pendingApprovals.length > 0) {
        machine.transition("awaiting_human");
        await writeRunSnapshot(true); // 挂起态必须可查：phase=awaiting_human 强制快照
        input.hooks?.onProgress?.(
          `等待人工审批（${pendingApprovals.map((m) => m.approvalId).join(", ")}），运行已挂起`,
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

      // AFTER_TOOL_BATCH：Steering 注入后再进入下一轮 LLM
      const steers = input.runQueues?.takeSteer() ?? [];
      if (steers.length > 0) {
        await injectUserMessages(input, llmMessages, steers, "steer");
      }

      // 下一轮 LLM
      machine.transition("llm");
    }

    // maxRounds 耗尽且未因预算进入 synthesizing
    if (machine.phase === "llm" || machine.phase === "tool_batch") {
      machine.transition("synthesizing");
    }

    if (machine.phase === "synthesizing") {
      const hasToolWork = executedTools.some(
        (t) => t.name !== "__thinking__" && t.name !== "__content__",
      );
      if (hasToolWork && !input.signal?.aborted) {
        try {
          const synthesis = await input.transport.complete({
            messages: llmMessages,
            signal: input.signal,
            withTools: false,
          });
          accumulateUsage(synthesis.tokenUsage);
          if (synthesis.model) lastModel = synthesis.model;
          if (synthesis.provider) lastProvider = synthesis.provider;
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
        } catch {
          /* 合成失败落兜底 */
        }
      }

      const fallback = hitToolBudget
        ? `已达到单次运行工具调用上限（${snapshot.maxToolCalls}）。可通过环境变量 AGENT_MAX_TOOL_CALLS_PER_RUN 调整。`
        : `已达到最大工具调用轮次（${snapshot.maxRounds}）。可通过环境变量 AGENT_MAX_TOOL_ROUNDS 调整上限。`;
      // 流式：兜底文案也推给前端
      input.hooks?.onToken?.(fallback);
      machine.transition("done");
      await finalizeRun("success", { content: fallback });
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
    const isAbort =
      input.signal?.aborted === true || (err instanceof Error && err.name === "AbortError");
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
