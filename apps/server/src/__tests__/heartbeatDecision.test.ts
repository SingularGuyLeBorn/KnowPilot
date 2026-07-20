/**
 * W2 心跳决策层 — 纯函数决策表
 *
 * 覆盖：各 mode 边界、退避 1→3→7→cap、reset_token 归零、
 * wait_user_gate summary 必填、terminal 连续 K 次 quiet。
 */

import { describe, it, expect } from "vitest";
import {
  buildHeartbeatDecision,
  buildResetToken,
  emptyDecisionState,
  nextBackoffSkipTicks,
  parseDecisionState,
  shouldNotifyUserGate,
  withGateNotifyStamp,
  type HeartbeatDecisionState,
  type HeartbeatSignals,
} from "../infra/heartbeatDecision.js";

function baseSignals(over: Partial<HeartbeatSignals> = {}): HeartbeatSignals {
  return {
    enabled: true,
    goal: "每日巡检",
    openApprovals: 0,
    pendingAskUser: 0,
    queuedItems: 0,
    lastRunId: null,
    lastRunAt: null,
    consecutiveFailures: 0,
    lastRunProductive: false,
    budgetExceeded: false,
    lastUserMessageAtBucket: null,
    decisionState: emptyDecisionState(),
    quietCap: 8,
    terminalAfterQuiet: 3,
    nowIso: "2026-07-21T00:00:00.000Z",
    ...over,
  };
}

describe("heartbeatDecision 退避公式", () => {
  it("quiet→1,3,7…cap", () => {
    expect(nextBackoffSkipTicks(0, 8)).toBe(1);
    expect(nextBackoffSkipTicks(1, 8)).toBe(3);
    expect(nextBackoffSkipTicks(3, 8)).toBe(7);
    expect(nextBackoffSkipTicks(7, 8)).toBe(8);
    expect(nextBackoffSkipTicks(8, 8)).toBe(8);
  });
});

describe("heartbeatDecision 决策表", () => {
  it("未启用 → quiet（identity）", () => {
    const d = buildHeartbeatDecision(baseSignals({ enabled: false }));
    expect(d.mode).toBe("quiet");
    expect(d.reasons.some((r) => r.includes("未启用"))).toBe(true);
    expect(d.skipOnlyDecrement).toBe(false);
  });

  it("goal 为空 → quiet（boundary）", () => {
    const d = buildHeartbeatDecision(baseSignals({ goal: "  " }));
    expect(d.mode).toBe("quiet");
    expect(d.reasons.some((r) => r.includes("goal"))).toBe(true);
  });

  it("有待审批 → wait_user_gate 且 summary 非空", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        openApprovals: 2,
        openApprovalSummary: "待批 git_commit（session abc）",
        lastRunAt: "2026-07-20T00:00:00.000Z",
      }),
    );
    expect(d.mode).toBe("wait_user_gate");
    expect(d.userGate).toBeDefined();
    expect(d.userGate!.kind).toBe("approval");
    expect(d.userGate!.summary.trim().length).toBeGreaterThan(0);
    expect(d.userGate!.summary).toContain("git_commit");
  });

  it("pendingAskUser 优先于 approval，summary 必填", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        openApprovals: 1,
        pendingAskUser: 1,
        pendingAskUserSummary: "是否继续归档旧文章？",
        lastRunAt: "2026-07-20T00:00:00.000Z",
      }),
    );
    expect(d.mode).toBe("wait_user_gate");
    expect(d.userGate!.kind).toBe("ask_user");
    expect(d.userGate!.summary).toContain("归档");
  });

  it("wait_user_gate 无注入 summary 时仍生成非空兜底（禁止空串）", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        openApprovals: 3,
        openApprovalSummary: null,
        lastRunAt: "2026-07-20T00:00:00.000Z",
      }),
    );
    expect(d.mode).toBe("wait_user_gate");
    expect(d.userGate!.summary.trim().length).toBeGreaterThan(0);
  });

  it("budget 超限 → quiet 并推进退避", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        budgetExceeded: true,
        lastRunAt: "2026-07-20T00:00:00.000Z",
        queuedItems: 1,
      }),
    );
    expect(d.mode).toBe("quiet");
    expect(d.reasons.some((r) => r.includes("预算"))).toBe(true);
    expect(d.skipTicks).toBe(1);
    expect(d.nextState.skipRemaining).toBe(1);
  });

  it("首轮（无 lastRunAt）→ bounded_delivery", () => {
    const d = buildHeartbeatDecision(baseSignals());
    expect(d.mode).toBe("bounded_delivery");
    expect(d.nextState.quietStreak).toBe(0);
  });

  it("决策态刚清空（配置变更/resume）即使有 lastRunAt 也重新投递", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        lastRunAt: "2026-07-20T00:00:00.000Z",
        lastRunId: "run-old",
        decisionState: emptyDecisionState(),
      }),
    );
    expect(d.mode).toBe("bounded_delivery");
    expect(d.reasons.some((r) => r.includes("重置"))).toBe(true);
  });

  it("有队列且连续 2 轮无产出 → repair", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        queuedItems: 2,
        lastRunAt: "2026-07-20T00:00:00.000Z",
        lastRunId: "run-1",
        lastRunProductive: false,
        consecutiveFailures: 0,
        // 上一 tick 已记 1 次无产出 → 本 tick 凑满 2 进 repair
        decisionState: { ...emptyDecisionState(), stallUnproductiveStreak: 1 },
      }),
    );
    expect(d.mode).toBe("repair");
  });

  it("无队列连续 quiet → monitor，第 K 次 terminal", () => {
    // 已跑过一轮投递后的决策态（非 fresh）
    let state: HeartbeatDecisionState = {
      ...emptyDecisionState(),
      lastMode: "bounded_delivery",
      resetToken: "already-ran",
    };
    const ran = {
      lastRunAt: "2026-07-20T00:00:00.000Z",
      lastRunId: "run-1",
    };

    const d1 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state }));
    expect(d1.mode).toBe("monitor_quiet_skip");
    expect(d1.skipTicks).toBe(1);
    state = d1.nextState;

    // 消耗 skip
    const skip = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state }));
    expect(skip.skipOnlyDecrement).toBe(true);
    state = skip.nextState;

    const d2 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state }));
    expect(d2.mode).toBe("monitor_quiet_skip");
    expect(d2.skipTicks).toBe(3);
    state = d2.nextState;
    // 耗尽 skipRemaining=3
    for (let i = 0; i < 3; i++) {
      const s = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state }));
      expect(s.skipOnlyDecrement).toBe(true);
      state = s.nextState;
    }

    // 第 3 次 quiet 决策 → terminal（terminalAfterQuiet=3）
    const d3 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state }));
    expect(d3.mode).toBe("terminal_no_followup");
    expect(d3.shouldSuspendTerminal).toBe(true);
    expect(d3.nextState.terminalAt).toBeTruthy();
    expect(d3.nextState.quietStreak).toBeGreaterThanOrEqual(3);
  });

  it("退避推进 1→3→7→cap，reset_token 变化归零", () => {
    let state: HeartbeatDecisionState = {
      ...emptyDecisionState(),
      lastMode: "bounded_delivery",
      resetToken: "seed",
    };
    const ran = { lastRunAt: "2026-07-20T00:00:00.000Z", lastRunId: "run-a" };

    const q1 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true }));
    expect(q1.skipTicks).toBe(1);
    state = q1.nextState;
    // 耗尽
    state = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true })).nextState;

    const q2 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true }));
    expect(q2.skipTicks).toBe(3);
    state = q2.nextState;
    for (let i = 0; i < 3; i++) {
      state = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true })).nextState;
    }

    const q3 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true }));
    expect(q3.skipTicks).toBe(7);
    state = q3.nextState;
    for (let i = 0; i < 7; i++) {
      state = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true })).nextState;
    }

    const q4 = buildHeartbeatDecision(baseSignals({ ...ran, decisionState: state, budgetExceeded: true }));
    expect(q4.skipTicks).toBe(8);

    // reset_token 变化（queuedItems）→ 立即归零并可重新决策
    const reset = buildHeartbeatDecision(
      baseSignals({
        ...ran,
        decisionState: q4.nextState,
        budgetExceeded: false,
        queuedItems: 1,
        lastRunProductive: true,
      }),
    );
    expect(reset.skipOnlyDecrement).toBe(false);
    expect(reset.nextState.skipRemaining).toBe(0);
    expect(reset.nextState.lastSkipTicks).toBe(0);
    expect(reset.mode).toBe("bounded_delivery");
  });

  it("buildResetToken 随信号变化", () => {
    const a = buildResetToken({
      openApprovals: 0,
      pendingAskUser: 0,
      queuedItems: 0,
      lastRunId: "x",
      consecutiveFailures: 0,
      lastUserMessageAtBucket: null,
    });
    const b = buildResetToken({
      openApprovals: 0,
      pendingAskUser: 0,
      queuedItems: 1,
      lastRunId: "x",
      consecutiveFailures: 0,
      lastUserMessageAtBucket: null,
    });
    expect(a).not.toBe(b);
    expect(a).toHaveLength(16);
  });

  it("parseDecisionState 容错", () => {
    expect(parseDecisionState(null).skipRemaining).toBe(0);
    expect(parseDecisionState({ skipRemaining: 2, lastMode: "quiet" }).lastMode).toBe("quiet");
    expect(parseDecisionState({ lastMode: "nope" }).lastMode).toBeNull();
  });

  it("gate 通知冷却：同 key 窗口内只通知一次", () => {
    const d = buildHeartbeatDecision(
      baseSignals({
        pendingAskUser: 1,
        pendingAskUserSummary: "确认删除？",
        lastRunAt: "2026-07-20T00:00:00.000Z",
      }),
    );
    const first = shouldNotifyUserGate({ decision: d, cooldownMs: 1_800_000, nowMs: 1_000_000 });
    expect(first.notify).toBe(true);
    expect(first.gateKey).toBeTruthy();

    const stamped = {
      ...d,
      nextState: withGateNotifyStamp(d.nextState, first.gateKey!, new Date(1_000_000).toISOString()),
    };
    const second = shouldNotifyUserGate({
      decision: stamped,
      cooldownMs: 1_800_000,
      nowMs: 1_000_000 + 60_000,
    });
    expect(second.notify).toBe(false);

    const after = shouldNotifyUserGate({
      decision: stamped,
      cooldownMs: 1_800_000,
      nowMs: 1_000_000 + 1_800_001,
    });
    expect(after.notify).toBe(true);
  });
});
