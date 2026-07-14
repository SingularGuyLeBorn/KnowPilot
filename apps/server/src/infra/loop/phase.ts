/**
 * Agent Run 显式状态机 — 后端 loop 不变量收口处
 *
 * phase: idle → compacting → llm ⇄ tool_batch → synthesizing → done
 *                                    ↘ awaiting_human → llm（W11 HITL 挂起/唤醒）
 *                                    ↘ failed（任意阶段）
 *
 * 非法转移直接抛错（程序员错误，禁止用编排层猜时序补救）。
 */

export type AgentRunPhase =
  | "idle"
  | "compacting"
  | "llm"
  | "tool_batch"
  /** W11：工具触发审批 pending，loop 挂起等待 approval_resolved 显式事件（禁止轮询） */
  | "awaiting_human"
  | "synthesizing"
  | "done"
  | "failed";

const TRANSITIONS: Record<AgentRunPhase, readonly AgentRunPhase[]> = {
  idle: ["compacting", "llm", "failed"],
  compacting: ["llm", "failed"],
  llm: ["tool_batch", "done", "synthesizing", "failed"],
  tool_batch: ["llm", "awaiting_human", "synthesizing", "failed"],
  awaiting_human: ["llm", "failed"],
  synthesizing: ["done", "failed"],
  done: [],
  failed: [],
};

export function createPhaseMachine(onPhase?: (to: AgentRunPhase, from: AgentRunPhase) => void) {
  let phase: AgentRunPhase = "idle";

  return {
    get phase(): AgentRunPhase {
      return phase;
    },
    transition(to: AgentRunPhase): void {
      if (phase === to) return;
      const allowed = TRANSITIONS[phase];
      if (!allowed.includes(to)) {
        throw new Error(`[AgentRunPhase] 非法转移: ${phase} → ${to}`);
      }
      const from = phase;
      phase = to;
      onPhase?.(to, from);
    },
    /** 测试/调试用：不校验直接设置（仅测试） */
    __unsafeSet(to: AgentRunPhase): void {
      phase = to;
    },
  };
}

export type PhaseMachine = ReturnType<typeof createPhaseMachine>;
