/**
 * 工具调用死循环熔断（DeerFlow LoopDetection 启发）。
 * 纯函数：同 name + 稳定 args 指纹连续命中阈值 → 阻断。
 */

export type ToolCallFingerprintInput = {
  name: string;
  args: Record<string, unknown>;
};

export type LoopGuardState = {
  /** fingerprint → 连续命中次数（中间被不同 call 打断则归零该链） */
  streakFp: string | null;
  streakCount: number;
  /** 本 run 已见过的指纹历史（最近 N） */
  recent: string[];
};

export type LoopGuardVerdict =
  | { blocked: false; state: LoopGuardState }
  | {
      blocked: true;
      state: LoopGuardState;
      fingerprint: string;
      message: string;
    };

const DEFAULT_STREAK = 3;
const RECENT_CAP = 32;

/** 稳定序列化：键排序，避免同参不同字段序误判为不同 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function toolCallFingerprint(call: ToolCallFingerprintInput): string {
  const name = String(call.name || "").replace(/^native:/, "");
  return `${name}::${stableStringify(call.args ?? {})}`;
}

export function createLoopGuardState(): LoopGuardState {
  return { streakFp: null, streakCount: 0, recent: [] };
}

/**
 * 检查本批 tool calls；任一指纹连续 streakLimit 次（含历史 streak）则 blocked。
 * 批内多个不同 call 会打断 streak（只对「同指纹连续」计）。
 */
export function checkToolLoop(
  state: LoopGuardState,
  calls: ToolCallFingerprintInput[],
  streakLimit = DEFAULT_STREAK,
): LoopGuardVerdict {
  let streakFp = state.streakFp;
  let streakCount = state.streakCount;
  const recent = [...state.recent];

  for (const call of calls) {
    const fp = toolCallFingerprint(call);
    if (streakFp === fp) {
      streakCount += 1;
    } else {
      streakFp = fp;
      streakCount = 1;
    }
    recent.push(fp);
    while (recent.length > RECENT_CAP) recent.shift();

    if (streakCount >= streakLimit) {
      const next: LoopGuardState = { streakFp, streakCount, recent };
      return {
        blocked: true,
        state: next,
        fingerprint: fp,
        message:
          `检测到工具死循环：连续 ${streakCount} 次相同调用（${fp.slice(0, 120)}）。` +
          `请改换策略或向用户说明卡点，禁止再以相同参数重试。`,
      };
    }
  }

  return {
    blocked: false,
    state: { streakFp, streakCount, recent },
  };
}
