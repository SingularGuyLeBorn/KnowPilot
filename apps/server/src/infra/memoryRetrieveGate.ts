/**
 * 记忆检索门控（retrieve-or-not）— 综述①§7.2
 *
 * 连续 N 次无命中后，跳过随后 skipAfterMiss 次检索，降低无谓 FTS 成本。
 * 进程内状态（单用户本地）；重启后清零（可接受）。
 */

const MISS_STREAK_TO_SKIP = 3;
const SKIP_AFTER_MISS = 2;

type GateState = { missStreak: number; skipRemaining: number };

const gates = new Map<string, GateState>();

export function __resetMemoryRetrieveGatesForTests(): void {
  gates.clear();
}

/** true = 本轮应跳过检索 */
export function shouldSkipMemoryRetrieve(gateKey: string): boolean {
  const s = gates.get(gateKey);
  if (!s || s.skipRemaining <= 0) return false;
  s.skipRemaining -= 1;
  return true;
}

/** 记录本轮检索结果，更新 miss streak / skip 配额 */
export function recordMemoryRetrieveOutcome(gateKey: string, hit: boolean): void {
  if (hit) {
    gates.set(gateKey, { missStreak: 0, skipRemaining: 0 });
    return;
  }
  const s = gates.get(gateKey) ?? { missStreak: 0, skipRemaining: 0 };
  s.missStreak += 1;
  if (s.missStreak >= MISS_STREAK_TO_SKIP) {
    s.skipRemaining = SKIP_AFTER_MISS;
    s.missStreak = 0;
  }
  gates.set(gateKey, s);
}

export const MEMORY_RETRIEVE_GATE = {
  MISS_STREAK_TO_SKIP,
  SKIP_AFTER_MISS,
} as const;
