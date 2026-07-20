/**
 * 心跳决策层（纯函数叶子）
 *
 * 决策流水线（固定顺序，禁止调换）：
 *   1. reset_token 对齐（身份哈希变化 → skipRemaining 归零）
 *   2. skipRemaining>0 → 只 decrement，不决策
 *   3. identity/boundary（agent 启用？目标在？）
 *   4. user gate 归一化（待审批 / ask_user → wait_user_gate，附具体 summary）
 *   5. budget/health（超限 → quiet）
 *   6. frontier（无待办 → terminal 判定或 monitor_quiet_skip；有但无进展 → quiet/repair）
 *   7. 默认 bounded_delivery
 *
 * 禁止 import prisma / ServiceContainer——信号由 heartbeatEngine 收集注入。
 */

import { createHash } from "node:crypto";
import { scopesIntersect } from "./approvalScope.js";

export type HeartbeatDecisionMode =
  | "bounded_delivery"
  | "wait_user_gate"
  | "monitor_quiet_skip"
  | "quiet"
  | "repair"
  | "terminal_no_followup";

export type HeartbeatUserGate = {
  kind: "approval" | "ask_user";
  /** 人类可读待办摘要——mode=wait_user_gate 时必填，禁止空串 */
  summary: string;
  /** W3：被堵 decisionScope 清单（审批 gate 时附带） */
  blockedScopes?: string[];
};

/** 持久化在 Agent.heartbeat.decision 子键（与配置态分列，json_set 原子写） */
export type HeartbeatDecisionState = {
  skipRemaining: number;
  resetToken: string;
  lastMode: HeartbeatDecisionMode | null;
  quietStreak: number;
  /** 上次 quiet/monitor 发出的 skipTicks，供指数退避推进 */
  lastSkipTicks: number;
  /** 上次对同一 gate 发出通知的时间（ISO）；冷却由引擎侧检查 */
  lastGateNotifyAt: string | null;
  lastGateNotifyKey: string | null;
  /** 目标闭合进入 terminal 的时刻；refresh 据此拒绝自动摘除 suspended */
  terminalAt: string | null;
  /** W3：同一 gate 生命周期内 safe bypass 是否已用过 */
  safeBypassUsed: boolean;
  /** W3：safe bypass 绑定的 gate key（gate 变化时重置 used） */
  safeBypassGateKey: string | null;
};

export type HeartbeatSignals = {
  enabled: boolean;
  goal: string;
  openApprovals: number;
  pendingAskUser: number;
  /** 待审批摘要（非空时优先用于 userGate.summary） */
  openApprovalSummary?: string | null;
  /** 待 ask_user 摘要 */
  pendingAskUserSummary?: string | null;
  /**
   * W3：pending 审批的 decisionScope（由引擎从 DB 注入）。
   * 与 agentRequiredScopes 相交 → 本 Agent 被堵；不相交且有队列 → 可 bounded_delivery。
   */
  pendingApprovalScopes?: Array<{ approvalId: string; scope: string }>;
  /** W3：本 Agent 工具集静态推导的 requiredScopes */
  agentRequiredScopes?: string[];
  queuedItems: number;
  lastRunId: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  /** v1：最近一次 run 是否有 toolCalls>0 */
  lastRunProductive: boolean;
  budgetExceeded: boolean;
  /** 用户在该 agent 会话发消息的粗粒度分桶（如 5min），进 reset_token */
  lastUserMessageAtBucket: string | null;
  decisionState: HeartbeatDecisionState;
  quietCap: number;
  terminalAfterQuiet: number;
  /** 可选：注入 now（ISO）供 terminalAt；缺省用 new Date() */
  nowIso?: string;
};

export type HeartbeatDecision = {
  mode: HeartbeatDecisionMode;
  reasons: string[];
  userGate?: HeartbeatUserGate;
  /** 本次跳过后还要再跳过几个 tick（写入 skipRemaining） */
  skipTicks: number;
  nextState: HeartbeatDecisionState;
  /** mode=terminal_no_followup 时置 true → 引擎写 heartbeatSuspendedAt */
  shouldSuspendTerminal: boolean;
  /** skipRemaining 消耗路径：本 tick 不跑 agent */
  skipOnlyDecrement: boolean;
  /** W3：mode=wait_user_gate 且尚未用过 safe bypass → 引擎可派一个只读 turn */
  safeBypassAllowed?: boolean;
  /** W3：被堵 scope 清单（决策可观测） */
  blockedScopes?: string[];
};

export function emptyDecisionState(): HeartbeatDecisionState {
  return {
    skipRemaining: 0,
    resetToken: "",
    lastMode: null,
    quietStreak: 0,
    lastSkipTicks: 0,
    lastGateNotifyAt: null,
    lastGateNotifyKey: null,
    terminalAt: null,
    safeBypassUsed: false,
    safeBypassGateKey: null,
  };
}

export function parseDecisionState(raw: unknown): HeartbeatDecisionState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyDecisionState();
  const d = raw as Record<string, unknown>;
  const lastMode = d.lastMode;
  const validModes: HeartbeatDecisionMode[] = [
    "bounded_delivery",
    "wait_user_gate",
    "monitor_quiet_skip",
    "quiet",
    "repair",
    "terminal_no_followup",
  ];
  return {
    skipRemaining: Math.max(0, Number(d.skipRemaining ?? 0) || 0),
    resetToken: typeof d.resetToken === "string" ? d.resetToken : "",
    lastMode:
      typeof lastMode === "string" && validModes.includes(lastMode as HeartbeatDecisionMode)
        ? (lastMode as HeartbeatDecisionMode)
        : null,
    quietStreak: Math.max(0, Number(d.quietStreak ?? 0) || 0),
    lastSkipTicks: Math.max(0, Number(d.lastSkipTicks ?? 0) || 0),
    lastGateNotifyAt: typeof d.lastGateNotifyAt === "string" ? d.lastGateNotifyAt : null,
    lastGateNotifyKey: typeof d.lastGateNotifyKey === "string" ? d.lastGateNotifyKey : null,
    terminalAt: typeof d.terminalAt === "string" ? d.terminalAt : null,
    safeBypassUsed: d.safeBypassUsed === true,
    safeBypassGateKey: typeof d.safeBypassGateKey === "string" ? d.safeBypassGateKey : null,
  };
}

/** 对「决策身份」做 sha1；变化即视为有新进展/新变化 → 退避归零 */
export function buildResetToken(signals: Pick<
  HeartbeatSignals,
  | "openApprovals"
  | "pendingAskUser"
  | "queuedItems"
  | "lastRunId"
  | "consecutiveFailures"
  | "lastUserMessageAtBucket"
>): string {
  const raw = [
    signals.openApprovals,
    signals.pendingAskUser,
    signals.queuedItems,
    signals.lastRunId ?? "",
    signals.consecutiveFailures,
    signals.lastUserMessageAtBucket ?? "",
  ].join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

/** 用户消息时间粗粒度分桶（默认 5 分钟），避免每 token 都改 reset_token */
export function bucketUserMessageAt(ms: number | null | undefined, bucketMs = 5 * 60_000): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return String(Math.floor(ms / bucketMs) * bucketMs);
}

export function nextBackoffSkipTicks(prevSkipTicks: number, quietCap: number): number {
  const cap = Math.max(1, quietCap);
  const prev = Math.max(0, prevSkipTicks);
  return Math.min(prev * 2 + 1, cap);
}

function withQuietBackoff(
  state: HeartbeatDecisionState,
  mode: "quiet" | "monitor_quiet_skip",
  reasons: string[],
  quietCap: number,
  resetToken: string,
): HeartbeatDecision {
  const skipTicks = nextBackoffSkipTicks(state.lastSkipTicks, quietCap);
  const quietStreak = state.quietStreak + 1;
  return {
    mode,
    reasons,
    skipTicks,
    shouldSuspendTerminal: false,
    skipOnlyDecrement: false,
    nextState: {
      ...state,
      skipRemaining: skipTicks,
      resetToken,
      lastMode: mode,
      quietStreak,
      lastSkipTicks: skipTicks,
      terminalAt: null,
    },
  };
}

/**
 * 构建本 tick 心跳决策。
 * wait_user_gate 时强制附带非空 userGate.summary（缺 summary 视为实现错误，调用方测试会红）。
 */
export function buildHeartbeatDecision(signals: HeartbeatSignals): HeartbeatDecision {
  const nowIso = signals.nowIso ?? new Date().toISOString();
  const quietCap = Math.max(1, signals.quietCap);
  const terminalAfterQuiet = Math.max(1, signals.terminalAfterQuiet);
  const resetToken = buildResetToken(signals);
  let state = { ...signals.decisionState };

  // 1. reset_token 变化 → 退避归零（保留 quietStreak/terminal 由后续分支处理）
  if (resetToken !== state.resetToken) {
    state = {
      ...state,
      skipRemaining: 0,
      lastSkipTicks: 0,
      resetToken,
    };
  } else {
    state = { ...state, resetToken };
  }

  // 2. skipRemaining>0 → 只 decrement
  if (state.skipRemaining > 0) {
    const nextRemaining = state.skipRemaining - 1;
    return {
      mode: state.lastMode ?? "quiet",
      reasons: [`退避中：剩余跳过 ${state.skipRemaining} → ${nextRemaining}`],
      skipTicks: nextRemaining,
      shouldSuspendTerminal: false,
      skipOnlyDecrement: true,
      nextState: {
        ...state,
        skipRemaining: nextRemaining,
      },
    };
  }

  // 3. identity / boundary
  if (!signals.enabled) {
    return {
      mode: "quiet",
      reasons: ["identity：心跳未启用"],
      skipTicks: 0,
      shouldSuspendTerminal: false,
      skipOnlyDecrement: false,
      nextState: { ...state, lastMode: "quiet", skipRemaining: 0 },
    };
  }
  if (!signals.goal.trim()) {
    return {
      mode: "quiet",
      reasons: ["boundary：心跳目标 goal 为空"],
      skipTicks: 0,
      shouldSuspendTerminal: false,
      skipOnlyDecrement: false,
      nextState: { ...state, lastMode: "quiet", skipRemaining: 0 },
    };
  }

  // 4. user gate（W3：审批按 scope 相交；不相交且有队列 → 其余推进）
  if (signals.openApprovals > 0 || signals.pendingAskUser > 0) {
    const preferAsk = signals.pendingAskUser > 0;

    // ask_user 仍全局挂起（无 scope 模型）
    if (!preferAsk && signals.openApprovals > 0) {
      const pendingScopes = (signals.pendingApprovalScopes ?? [])
        .map((r) => r.scope)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      const required = signals.agentRequiredScopes ?? [];
      const blocked =
        pendingScopes.length > 0 && required.length > 0 && scopesIntersect(required, pendingScopes)
          ? pendingScopes.filter((s) => scopesIntersect(required, [s]))
          : pendingScopes.length > 0 && required.length === 0
            ? pendingScopes // 无工具声明时保守：视为全堵
            : pendingScopes.length > 0 && scopesIntersect(required, pendingScopes)
              ? pendingScopes
              : [];

      const intersects =
        required.length === 0
          ? signals.openApprovals > 0
          : scopesIntersect(required, pendingScopes);

      if (!intersects && signals.queuedItems > 0) {
        const scopeHint = pendingScopes.length > 0 ? pendingScopes.join(", ") : "（未知）";
        return {
          mode: "bounded_delivery",
          reasons: [
            `gate 仅阻塞 scope ${scopeHint}，本 Agent 无相交，其余推进（queued=${signals.queuedItems}）`,
          ],
          skipTicks: 0,
          shouldSuspendTerminal: false,
          skipOnlyDecrement: false,
          blockedScopes: pendingScopes,
          nextState: {
            ...state,
            lastMode: "bounded_delivery",
            skipRemaining: 0,
            lastSkipTicks: 0,
            quietStreak: 0,
            terminalAt: null,
            // 非 wait 路径：清掉 bypass 态，避免跨 gate 残留
            safeBypassUsed: false,
            safeBypassGateKey: null,
          },
        };
      }

      if (intersects || signals.openApprovals > 0) {
        const summary =
          signals.openApprovalSummary?.trim() ||
          `有 ${signals.openApprovals} 条审批待处理`;
        if (!summary.trim()) {
          throw new Error("heartbeatDecision: wait_user_gate 缺少 userGate.summary");
        }
        const blockedList = blocked.length > 0 ? blocked : pendingScopes;
        const gateKey = `approval:${[...blockedList].sort().join("|") || "any"}`;
        // gate key 变化 → 允许新一轮 safe bypass
        const bypassUsed =
          state.safeBypassUsed && state.safeBypassGateKey === gateKey;
        const safeBypassAllowed = !bypassUsed;
        return {
          mode: "wait_user_gate",
          reasons: [
            `user_gate：openApprovals=${signals.openApprovals}`,
            ...(blockedList.length > 0 ? [`被堵 scope：${blockedList.join(", ")}`] : []),
            ...(safeBypassAllowed ? ["safe_bypass：允许一次只读 turn"] : []),
          ],
          userGate: { kind: "approval", summary, blockedScopes: blockedList },
          skipTicks: 0,
          shouldSuspendTerminal: false,
          skipOnlyDecrement: false,
          safeBypassAllowed,
          blockedScopes: blockedList,
          nextState: {
            ...state,
            lastMode: "wait_user_gate",
            skipRemaining: 0,
            lastSkipTicks: 0,
            quietStreak: 0,
            terminalAt: null,
            safeBypassGateKey: gateKey,
            // 本决策不置 used——引擎在实际派发只读 turn 后 stamp
            safeBypassUsed: bypassUsed,
          },
        };
      }
    }

    const kind: HeartbeatUserGate["kind"] = preferAsk ? "ask_user" : "approval";
    const summary = preferAsk
      ? (signals.pendingAskUserSummary?.trim() ||
        `有 ${signals.pendingAskUser} 条 ask_user 待答复`)
      : (signals.openApprovalSummary?.trim() ||
        `有 ${signals.openApprovals} 条审批待处理`);
    if (!summary.trim()) {
      // 实现错误防护：绝不发出无 summary 的 wait_user_gate
      throw new Error("heartbeatDecision: wait_user_gate 缺少 userGate.summary");
    }
    return {
      mode: "wait_user_gate",
      reasons: [
        preferAsk
          ? `user_gate：pendingAskUser=${signals.pendingAskUser}`
          : `user_gate：openApprovals=${signals.openApprovals}`,
      ],
      userGate: { kind, summary },
      skipTicks: 0,
      shouldSuspendTerminal: false,
      skipOnlyDecrement: false,
      safeBypassAllowed: false,
      nextState: {
        ...state,
        lastMode: "wait_user_gate",
        skipRemaining: 0,
        lastSkipTicks: 0,
        // 等人期间不累计 quiet（不是「无进展」）
        quietStreak: 0,
        terminalAt: null,
      },
    };
  }

  // 5. budget / health
  if (signals.budgetExceeded) {
    return withQuietBackoff(state, "quiet", ["budget：LLM 预算已超限"], quietCap, resetToken);
  }

  // 待办信号：从未跑过 / 决策态刚清空（配置变更/resume）/ 队列有项 / 失败 streak。
  // 纯 goal 心跳首轮投递，其后无队列且无失败 streak 则 quiet→terminal。
  const neverRan = !signals.lastRunAt;
  const freshDecision =
    state.lastMode == null && state.quietStreak === 0 && !state.terminalAt;
  const hasQueue = signals.queuedItems > 0;
  const inFailureStreak = signals.consecutiveFailures > 0;
  const nextQuietStreak = state.quietStreak + 1;

  // 6. frontier
  if (!neverRan && !hasQueue && !inFailureStreak && !freshDecision) {
    // 无 gate、无队列、无失败 streak：累计 quiet；达 K → 目标闭合
    if (nextQuietStreak >= terminalAfterQuiet) {
      return {
        mode: "terminal_no_followup",
        reasons: [
          `terminal：连续 ${nextQuietStreak} 次 quiet（阈值 ${terminalAfterQuiet}），无 gate/队列，目标闭合`,
        ],
        skipTicks: 0,
        shouldSuspendTerminal: true,
        skipOnlyDecrement: false,
        nextState: {
          ...state,
          lastMode: "terminal_no_followup",
          quietStreak: nextQuietStreak,
          skipRemaining: 0,
          lastSkipTicks: 0,
          terminalAt: nowIso,
        },
      };
    }
    return withQuietBackoff(
      state,
      "monitor_quiet_skip",
      ["frontier：无队列待办，纯监听无变化"],
      quietCap,
      resetToken,
    );
  }

  // 有队列但上轮无实质进展、且非失败 streak → repair（v1）
  if (hasQueue && !signals.lastRunProductive && signals.lastRunAt && !inFailureStreak) {
    return {
      mode: "repair",
      reasons: ["frontier：有队列但上轮无 tool 产出，进入有界修复"],
      skipTicks: 0,
      shouldSuspendTerminal: false,
      skipOnlyDecrement: false,
      nextState: {
        ...state,
        lastMode: "repair",
        skipRemaining: 0,
        lastSkipTicks: 0,
        quietStreak: 0,
        terminalAt: null,
      },
    };
  }

  // 7. 默认正常投递（首轮 / 决策态重置 / 有队列 / 失败 streak 续试）
  const reason = neverRan
    ? ["default：心跳尚未跑过，执行有界投递"]
    : freshDecision
      ? ["default：决策态已重置，重新投递"]
      : inFailureStreak
        ? [`default：失败 streak=${signals.consecutiveFailures}，继续投递直至熔断或成功`]
        : ["default：有待办信号，执行有界投递"];
  return {
    mode: "bounded_delivery",
    reasons: reason,
    skipTicks: 0,
    shouldSuspendTerminal: false,
    skipOnlyDecrement: false,
    nextState: {
      ...state,
      lastMode: "bounded_delivery",
      skipRemaining: 0,
      lastSkipTicks: 0,
      quietStreak: 0,
      terminalAt: null,
    },
  };
}

/** 是否应发送 gate 通知（冷却窗口内同 key 只通知一次） */
export function shouldNotifyUserGate(opts: {
  decision: HeartbeatDecision;
  cooldownMs: number;
  nowMs: number;
}): { notify: boolean; gateKey: string | null } {
  if (opts.decision.mode !== "wait_user_gate" || !opts.decision.userGate) {
    return { notify: false, gateKey: null };
  }
  const gateKey = `${opts.decision.userGate.kind}:${opts.decision.userGate.summary}`;
  const prevKey = opts.decision.nextState.lastGateNotifyKey;
  const prevAt = opts.decision.nextState.lastGateNotifyAt;
  // nextState 尚未写入本次通知；冷却读的是决策前 state——调用方应传入「决策前」的 state 字段
  // 这里用 nextState 里仍保留的旧 lastGate*（buildHeartbeatDecision 未改这两字段）
  if (prevKey === gateKey && prevAt) {
    const elapsed = opts.nowMs - Date.parse(prevAt);
    if (Number.isFinite(elapsed) && elapsed < opts.cooldownMs) {
      return { notify: false, gateKey };
    }
  }
  return { notify: true, gateKey };
}

export function withGateNotifyStamp(
  state: HeartbeatDecisionState,
  gateKey: string,
  nowIso: string,
): HeartbeatDecisionState {
  return {
    ...state,
    lastGateNotifyAt: nowIso,
    lastGateNotifyKey: gateKey,
  };
}
