/**
 * LoopContract — 长程控制平面（Phase 1：仅超级 Agent 心跳）
 *
 * 不替换 ReAct 执行器；只决定「这次心跳该不该跑」以及「有没有证据进展」。
 * 持久化挂在 Agent.heartbeat JSON 的 `loopContract` 字段，避免新增 Prisma 表。
 */

export interface LoopContractEvidence {
  at: string;
  summary: string;
  /** 归一化摘要指纹；相同则视为无新进展 */
  fingerprint: string;
  taskId?: string;
  status: "success" | "failed" | "cancelled" | "budget_exceeded" | "skipped";
}

export interface LoopContract {
  goal: string;
  /** false = 停心跳触发（stopRule 或人工关） */
  handoff: boolean;
  /** false = 显式人工 gate，跳过触发直至 resume */
  gateOpen: boolean;
  evidence: LoopContractEvidence[];
  stopRule: { maxStaleRounds: number };
  staleRounds: number;
  stoppedReason: string | null;
}

export interface LoopContractDefaults {
  maxStaleRounds: number;
  maxEvidence: number;
}

export const DEFAULT_LOOP_CONTRACT: LoopContractDefaults = {
  maxStaleRounds: 3,
  maxEvidence: 50,
};

/** 简单稳定指纹（非加密） */
export function evidenceFingerprint(summary: string): string {
  const norm = summary.trim().toLowerCase().replace(/\s+/g, " ");
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function parseLoopContract(raw: unknown): LoopContract | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stopRuleRaw = (o.stopRule as Record<string, unknown> | undefined) ?? {};
  const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
  return {
    goal: String(o.goal ?? ""),
    handoff: o.handoff !== false,
    gateOpen: o.gateOpen !== false,
    evidence: evidenceRaw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        at: String(e.at ?? ""),
        summary: String(e.summary ?? ""),
        fingerprint: String(e.fingerprint ?? evidenceFingerprint(String(e.summary ?? ""))),
        taskId: e.taskId != null ? String(e.taskId) : undefined,
        status: (["success", "failed", "cancelled", "budget_exceeded", "skipped"].includes(String(e.status))
          ? String(e.status)
          : "skipped") as LoopContractEvidence["status"],
      })),
    stopRule: {
      maxStaleRounds: Math.max(1, Number(stopRuleRaw.maxStaleRounds ?? DEFAULT_LOOP_CONTRACT.maxStaleRounds)),
    },
    staleRounds: Math.max(0, Number(o.staleRounds ?? 0)),
    stoppedReason: o.stoppedReason != null ? String(o.stoppedReason) : null,
  };
}

export function ensureLoopContract(
  goal: string,
  existing: unknown,
  defaults: LoopContractDefaults = DEFAULT_LOOP_CONTRACT,
): LoopContract {
  const parsed = parseLoopContract(existing);
  if (parsed) {
    return {
      ...parsed,
      goal: parsed.goal || goal,
      stopRule: {
        maxStaleRounds: Math.max(1, parsed.stopRule.maxStaleRounds || defaults.maxStaleRounds),
      },
    };
  }
  return {
    goal,
    handoff: true,
    gateOpen: true,
    evidence: [],
    stopRule: { maxStaleRounds: defaults.maxStaleRounds },
    staleRounds: 0,
    stoppedReason: null,
  };
}

export function shouldSkipHeartbeat(contract: LoopContract): { skip: boolean; reason?: string } {
  if (!contract.gateOpen) {
    return { skip: true, reason: "gate_closed：人工 gate 关闭，等待 resumeLoopContract" };
  }
  if (!contract.handoff) {
    return {
      skip: true,
      reason: `handoff_false：${contract.stoppedReason ?? "已停止交回 Agent"}`,
    };
  }
  return { skip: false };
}

export function recordEvidence(
  contract: LoopContract,
  entry: Omit<LoopContractEvidence, "fingerprint"> & { fingerprint?: string },
  defaults: LoopContractDefaults = DEFAULT_LOOP_CONTRACT,
): LoopContract {
  const fingerprint = entry.fingerprint ?? evidenceFingerprint(entry.summary);
  const last = contract.evidence[contract.evidence.length - 1];
  const isProgress =
    entry.status === "success" && (!last || last.fingerprint !== fingerprint);

  let staleRounds = contract.staleRounds;
  if (isProgress) {
    staleRounds = 0;
  } else {
    staleRounds += 1;
  }

  const evidence = [
    ...contract.evidence,
    {
      at: entry.at,
      summary: entry.summary,
      fingerprint,
      taskId: entry.taskId,
      status: entry.status,
    },
  ].slice(-Math.max(1, defaults.maxEvidence));

  let handoff = contract.handoff;
  let gateOpen = contract.gateOpen;
  let stoppedReason = contract.stoppedReason;

  if (staleRounds >= contract.stopRule.maxStaleRounds) {
    handoff = false;
    stoppedReason = `stopRule: 连续 ${staleRounds} 轮无新 evidence（上限 ${contract.stopRule.maxStaleRounds}）`;
  }

  return {
    ...contract,
    evidence,
    staleRounds,
    handoff,
    gateOpen,
    stoppedReason,
  };
}

/** 人工恢复：开 gate、交回 Agent、清 stop 原因与 stale 计数 */
export function resumeLoopContract(contract: LoopContract): LoopContract {
  return {
    ...contract,
    handoff: true,
    gateOpen: true,
    staleRounds: 0,
    stoppedReason: null,
  };
}

/** 人工关 gate（不改 handoff / evidence） */
export function closeLoopGate(contract: LoopContract, reason = "人工关闭 gate"): LoopContract {
  return {
    ...contract,
    gateOpen: false,
    handoff: false,
    stoppedReason: reason,
  };
}
