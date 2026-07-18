/**
 * Chat Goal / Deep Research 外环（对标 Hermes Ralph + goal_judge）
 *
 * 不变量：
 * - standing goal 存在 ChatSession.goalState
 * - 每轮 assistant done 后裁判；CONTINUE 只写 pendingContinue，由 onHubRunSettled 起下一轮
 * - 禁止 setTimeout / await hydrate 赌序；续跑唯一入口 = drainGoalContinueAfterSettle
 */

import type { SessionGoalState } from "@knowpilot/shared";
import { sessionGoalStateSchema } from "@knowpilot/shared";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { resolveAuxiliaryModel } from "./auxiliaryModel.js";
import { chatCompletion } from "./llmClient.js";
import { onHubRunSettled, getStreamHub } from "./sessionStreamHub.js";
import { prisma } from "../db.js";

/** 读写 goalState：绕过可能未 regenerate 的 Prisma Client 字段校验（列已由 ALTER 存在） */
export async function readGoalStateRaw(sessionId: string): Promise<SessionGoalState | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ goalState: string | null }>>(
    `SELECT goalState FROM ChatSession WHERE id = ?`,
    sessionId,
  );
  const raw = rows[0]?.goalState;
  if (raw == null) return null;
  try {
    return parseGoalState(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return null;
  }
}

export async function writeGoalStateRaw(
  sessionId: string,
  goal: SessionGoalState | null,
): Promise<void> {
  if (goal === null) {
    await prisma.$executeRawUnsafe(`UPDATE ChatSession SET goalState = NULL WHERE id = ?`, sessionId);
    return;
  }
  await prisma.$executeRawUnsafe(
    `UPDATE ChatSession SET goalState = ? WHERE id = ?`,
    JSON.stringify(goal),
    sessionId,
  );
}

type GoalStateStore = {
  read: (sessionId: string) => Promise<SessionGoalState | null>;
  write: (sessionId: string, goal: SessionGoalState | null) => Promise<void>;
};

let goalStateStore: GoalStateStore = {
  read: readGoalStateRaw,
  write: writeGoalStateRaw,
};

/** 测试注入内存 store，避免打真实 DB */
export function __setGoalStateStoreForTests(store: GoalStateStore | null): void {
  goalStateStore = store ?? { read: readGoalStateRaw, write: writeGoalStateRaw };
}

export const DEEP_RESEARCH_SYSTEM_HINT = `你正处于深度调研模式（Deep Research）。请按以下节奏工作：
1. 先列出调研提纲与待验证问题；
2. 用搜索/读文等工具多方取证，交叉验证；
3. 区分「已证实 / 存疑 / 未知」；
4. 最终给出带引用线索的结构化报告（结论、证据、缺口、下一步）。
不要过早宣称完成；证据不足时继续检索。`;

const JUDGE_SYSTEM = `You are a conservative goal completion judge.
Given a standing goal and the agent's latest final response, reply with ONLY one JSON object:
{"done": true|false, "reason": "<one sentence>"}
Mark done=true ONLY when the response explicitly confirms the goal is complete, clearly delivers the required artifact, or shows the goal is blocked/impossible (then done=true with a block reason so we stop burning budget).
Otherwise done=false with a short reason what remains.`;

export function parseGoalState(raw: unknown): SessionGoalState | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = sessionGoalStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function buildGoalContinueMessage(goal: SessionGoalState, reason: string): string {
  const modeLabel = goal.mode === "deep_research" ? "深度调研" : "目标";
  const research =
    goal.mode === "deep_research" ? `\n\n${DEEP_RESEARCH_SYSTEM_HINT}` : "";
  return [
    `↻ 继续推进${modeLabel}（${goal.turnsUsed}/${goal.maxTurns}）：${reason}`,
    ``,
    `Standing goal: ${goal.text}`,
    `请基于上一轮进展继续，不要重复已完成的步骤；完成后在回复中明确说明是否已达成目标。`,
    research,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGoalKickoffMessage(goal: SessionGoalState): string {
  if (goal.mode === "deep_research") {
    return [
      `⊙ 深度调研已设定（预算 ${goal.maxTurns} 轮）：${goal.text}`,
      ``,
      DEEP_RESEARCH_SYSTEM_HINT,
      ``,
      `请开始调研。`,
    ].join("\n");
  }
  return [
    `⊙ 目标已设定（预算 ${goal.maxTurns} 轮）：${goal.text}`,
    ``,
    `请开始推进该目标；完成后在回复中明确确认。`,
  ].join("\n");
}

export type GoalJudgeResult = { done: boolean; reason: string };

/** 供单测注入 */
export type GoalJudgeFn = (args: {
  goalText: string;
  lastAssistantText: string;
  model: string;
  config: AppConfig;
}) => Promise<GoalJudgeResult>;

export function parseJudgeOutput(raw: string): GoalJudgeResult | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { done?: unknown; reason?: unknown };
    if (typeof parsed.done !== "boolean") return null;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : parsed.done
          ? "Goal appears complete."
          : "Goal not yet complete.";
    return { done: parsed.done, reason };
  } catch {
    return null;
  }
}

export async function defaultJudgeGoalTurn(args: {
  goalText: string;
  lastAssistantText: string;
  model: string;
  config: AppConfig;
}): Promise<GoalJudgeResult> {
  const assistantSlice = args.lastAssistantText.slice(-4000);
  const result = await chatCompletion({
    config: args.config,
    model: args.model,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `Goal:\n${args.goalText}\n\nLatest agent response:\n${assistantSlice || "(empty)"}`,
      },
    ],
    temperature: 0,
    maxTokens: 200,
  });
  const parsed = parseJudgeOutput(result.content ?? "");
  // fail-open：解析失败当 continue
  return parsed ?? { done: false, reason: "Judge output unparseable; continue." };
}

export async function setSessionGoal(args: {
  services: ServiceContainer;
  config: AppConfig;
  sessionId: string;
  text: string;
  mode: "goal" | "deep_research";
  maxTurns?: number;
  judgeModel?: string;
  execModel?: string;
}): Promise<SessionGoalState> {
  const session = await args.services.session.getByIdLite(args.sessionId);
  if (!session) throw new Error("会话不存在");
  if (session.kind === "subagent" || session.parentSessionId) {
    throw new Error("子 Agent 会话不支持 Goal / 深度调研");
  }
  if (session.kind === "heartbeat" || session.kind === "skill_review") {
    throw new Error("该类型会话不支持 Goal / 深度调研");
  }
  if (args.mode === "deep_research") {
    // 深度调研必须在「尚未有用户消息」的新会话上启动
    const listed = await args.services.message.list({
      sessionId: args.sessionId,
      page: 1,
      pageSize: 20,
    });
    const items = (listed as { items?: Array<{ role?: string; source?: string | null }> })?.items ?? [];
    const hasUserMsg = items.some((m) => {
      if (m.role !== "user") return false;
      const src = m.source ?? "user";
      return src === "user";
    });
    if (hasUserMsg) {
      throw new Error("深度调研只能在新会话发送第一条消息之前选择");
    }
  }

  const defaults = args.config.goal;
  const maxTurns =
    args.maxTurns ??
    (args.mode === "deep_research" ? defaults.deepResearchMaxTurns : defaults.maxTurns);
  const goal: SessionGoalState = {
    mode: args.mode,
    text: args.text.trim(),
    status: "active",
    turnsUsed: 0,
    maxTurns,
    judgeModel: (args.judgeModel || defaults.judgeModel || "auto").trim() || "auto",
    execModel: args.execModel?.trim() || undefined,
    pendingContinue: null,
  };
  await goalStateStore.write(args.sessionId, goal);
  if (goal.execModel) {
    await args.services.session.update({ id: args.sessionId, model: goal.execModel } as never);
  }
  return goal;
}

export async function pauseSessionGoal(
  _services: ServiceContainer,
  sessionId: string,
): Promise<SessionGoalState | null> {
  const goal = await goalStateStore.read(sessionId);
  if (!goal) return null;
  const next: SessionGoalState = { ...goal, status: "paused", pendingContinue: null };
  await goalStateStore.write(sessionId, next);
  return next;
}

export async function resumeSessionGoal(
  _services: ServiceContainer,
  sessionId: string,
): Promise<SessionGoalState | null> {
  const goal = await goalStateStore.read(sessionId);
  if (!goal) return null;
  const next: SessionGoalState = {
    ...goal,
    status: "active",
    turnsUsed: 0,
    pendingContinue: null,
  };
  await goalStateStore.write(sessionId, next);
  return next;
}

export async function clearSessionGoal(
  _services: ServiceContainer,
  sessionId: string,
): Promise<void> {
  await goalStateStore.write(sessionId, null);
}

/**
 * 回合结束后：若 goal active，跑裁判并写回 goalState。
 * CONTINUE → pendingContinue（由 settled 钩子起流）；不在此处 startIfNotRunning。
 */
export async function evaluateGoalAfterTurn(args: {
  services: ServiceContainer;
  config: AppConfig;
  sessionId: string;
  lastAssistantText: string;
  mainModel: string;
  judgeFn?: GoalJudgeFn;
}): Promise<{ goal: SessionGoalState | null; action: "skip" | "done" | "continue" | "exhausted" }> {
  const goal = await goalStateStore.read(args.sessionId);
  if (!goal || goal.status !== "active") {
    return { goal, action: "skip" };
  }

  const turnsUsed = goal.turnsUsed + 1;
  if (turnsUsed >= goal.maxTurns) {
    const exhausted: SessionGoalState = {
      ...goal,
      turnsUsed,
      status: "exhausted",
      pendingContinue: null,
      lastVerdict: { done: false, reason: `Turn budget exhausted (${goal.maxTurns}).` },
    };
    await goalStateStore.write(args.sessionId, exhausted);
    return { goal: exhausted, action: "exhausted" };
  }

  const judgeModel = resolveAuxiliaryModel(args.config, {
    configured: goal.judgeModel || args.config.goal.judgeModel || "auto",
    mainModel: args.mainModel,
    preference: "strong_free",
  });

  let verdict: GoalJudgeResult;
  try {
    const judge = args.judgeFn ?? defaultJudgeGoalTurn;
    verdict = await judge({
      goalText: goal.text,
      lastAssistantText: args.lastAssistantText,
      model: judgeModel,
      config: args.config,
    });
  } catch (err) {
    // fail-open
    verdict = {
      done: false,
      reason: `Judge error; continue. (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  if (verdict.done) {
    const doneState: SessionGoalState = {
      ...goal,
      turnsUsed,
      status: "done",
      pendingContinue: null,
      lastVerdict: verdict,
    };
    await goalStateStore.write(args.sessionId, doneState);
    return { goal: doneState, action: "done" };
  }

  const cont: SessionGoalState = {
    ...goal,
    turnsUsed,
    status: "active",
    lastVerdict: verdict,
    pendingContinue: { reason: verdict.reason },
  };
  await goalStateStore.write(args.sessionId, cont);
  return { goal: cont, action: "continue" };
}

/**
 * onHubRunSettled：若有 pendingContinue，清标记后 startIfNotRunning 注入续跑消息。
 */
export async function drainGoalContinueAfterSettle(args: {
  services: ServiceContainer;
  config: AppConfig;
  sessionId: string;
  /** 测试可注入 */
  startContinuation?: (message: string, model?: string) => Promise<boolean>;
}): Promise<boolean> {
  const goal = await goalStateStore.read(args.sessionId);
  if (!goal || goal.status !== "active" || !goal.pendingContinue) return false;

  const reason = goal.pendingContinue.reason;
  const cleared: SessionGoalState = { ...goal, pendingContinue: null };
  // 条件式：先清 pending，避免 settled 重入双起
  await goalStateStore.write(args.sessionId, cleared);

  const session = await args.services.session.getByIdLite(args.sessionId);
  const message = buildGoalContinueMessage(cleared, reason);
  const model = cleared.execModel || session.model;

  if (args.startContinuation) {
    return args.startContinuation(message, model);
  }

  const hub = getStreamHub();
  if (!hub) return false;

  const { chatAgentStream } = await import("./agentStream.js");
  const { createTrpcInvoker } = await import("./trpcInvoker.js");
  const invoke = createTrpcInvoker({ services: args.services });

  const body = {
    sessionId: args.sessionId,
    agentId: session.agentId ?? undefined,
    message,
    model,
    source: "system" as const,
  };

  const started = await hub.startIfNotRunning(args.sessionId, body, (emit, signal) =>
    chatAgentStream(args.services, args.config, body, invoke, emit, signal),
  );
  return started;
}

let goalSettledHookRegistered = false;

/** 启动时挂一次；测试可 __reset */
export function registerGoalLoopSettledHook(
  services: ServiceContainer,
  config: AppConfig,
): () => void {
  if (goalSettledHookRegistered) return () => {};
  goalSettledHookRegistered = true;
  return onHubRunSettled((sessionId) => {
    void drainGoalContinueAfterSettle({ services, config, sessionId }).catch((err) => {
      console.warn(
        "[goalLoop] settled 续跑失败:",
        err instanceof Error ? err.message : err,
      );
    });
  });
}

export function __resetGoalLoopHookForTests(): void {
  goalSettledHookRegistered = false;
  __setGoalStateStoreForTests(null);
}
