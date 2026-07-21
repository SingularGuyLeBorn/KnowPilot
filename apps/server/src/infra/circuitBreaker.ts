/**
 * CircuitBreaker — 通用断路器（W12）
 *
 * 三态状态机：closed（正常）→ open（熔断）→ half-open（半开探测）→ closed
 *
 * 转移表（合法转移全集，除此之外一律拒绝）：
 * | 当前状态   | 事件                        | 下一状态   |
 * |-----------|-----------------------------|-----------|
 * | closed    | 连续失败达 failureThreshold  | open      |
 * | open      | openDurationMs 冷却到期      | half-open |
 * | half-open | 探测成功                     | closed    |
 * | half-open | 探测失败                     | open（重新计时） |
 *
 * 非法转移（拒绝，no-op + console.error，状态不变）：
 * - open → closed      （必须经 half-open 探测成功，不许直接合闸）
 * - closed → half-open （半开只能由 open 冷却到期进入）
 *
 * 铁律落地（AGENTS.md「状态机非法转移拒绝」）：
 * - state 为私有字段，唯一写入口是 transition() 内的转移表校验，外部无法乱设；
 * - open 期间到达的陈旧 recordSuccess/recordFailure（在途请求晚完成）不改变状态；
 * - half-open 放行探测时发放 probeToken；record* 须携带匹配令牌才计入探测结果；
 *   closed 期发出的迟到成功/失败（无令牌或令牌不匹配）在 half-open 一律忽略，
 *   避免误合闸 / 误重开，且不清掉真探测的 probeInFlight。
 * - half-open 同时只放行一个探测请求（probeInFlight），并发探测被拒。
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** 连续失败达到该次数后开闸（默认 5） */
  failureThreshold?: number;
  /** 开闸后冷却时长，到期转 half-open 放行探测（默认 60_000ms） */
  openDurationMs?: number;
  /** 时钟注入（测试用），默认 Date.now */
  now?: () => number;
}

export type CircuitPermit =
  | { allowed: true; /** half-open 探测令牌；closed 放行无此字段 */ probeToken?: number }
  | { allowed: false; retryAfterMs: number };

/** 合法转移表：唯一事实源。key=当前状态，value=允许到达的下一状态 */
const LEGAL_TRANSITIONS: Readonly<Record<CircuitState, readonly CircuitState[]>> = {
  closed: ["open"],
  open: ["half-open"],
  "half-open": ["closed", "open"],
};

export class CircuitBreaker {
  static readonly DEFAULT_FAILURE_THRESHOLD = 5;
  static readonly DEFAULT_OPEN_DURATION_MS = 60_000;

  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  /** 当前半开探测纪元令牌；非探测期为 null */
  private activeProbeToken: number | null = null;
  private probeEpoch = 0;

  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? CircuitBreaker.DEFAULT_FAILURE_THRESHOLD);
    this.openDurationMs = Math.max(1, options.openDurationMs ?? CircuitBreaker.DEFAULT_OPEN_DURATION_MS);
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failures;
  }

  /**
   * 唯一状态转移入口（含测试）：非法转移一律拒绝（no-op + console.error），返回是否转移成功。
   * 业务代码禁止直接调用——状态只能经 tryAcquire/recordSuccess/recordFailure 的事件语义驱动。
   */
  transition(to: CircuitState): boolean {
    if (to === this.state) return true; // 自环不算转移
    const legal = LEGAL_TRANSITIONS[this.state];
    if (!legal.includes(to)) {
      console.error(`[CircuitBreaker] 非法状态转移被拒绝: ${this.state} → ${to}`);
      return false;
    }
    this.state = to;
    return true;
  }

  /**
   * 执行前闸门：
   * - closed：放行（无 probeToken）；
   * - open：冷却未到期拒绝（附 retryAfterMs）；到期转 half-open 并放行唯一探测（附 probeToken）；
   * - half-open：无探测在途则放行探测（附 probeToken），否则拒绝。
   */
  tryAcquire(): CircuitPermit {
    if (this.state === "closed") return { allowed: true };

    if (this.state === "open") {
      const elapsed = this.now() - this.openedAt;
      if (elapsed < this.openDurationMs) {
        return { allowed: false, retryAfterMs: this.openDurationMs - elapsed };
      }
      if (this.transition("half-open")) {
        return { allowed: true, probeToken: this.beginProbe() };
      }
      return { allowed: false, retryAfterMs: this.openDurationMs };
    }

    // half-open
    if (this.probeInFlight) {
      return { allowed: false, retryAfterMs: this.openDurationMs };
    }
    return { allowed: true, probeToken: this.beginProbe() };
  }

  /**
   * 记录成功：
   * - closed：失败计数清零（忽略 probeToken）；
   * - half-open：仅匹配 activeProbeToken 的探测成功 → 合闸；令牌不匹配/缺失 = 迟到事件，忽略；
   * - open：陈旧完成忽略。
   */
  recordSuccess(probeToken?: number): void {
    if (this.state === "half-open") {
      if (!this.isActiveProbe(probeToken)) return;
      this.clearProbe();
      this.failures = 0;
      this.transition("closed");
      return;
    }
    if (this.state === "closed") {
      this.failures = 0;
    }
  }

  /**
   * 记录失败：
   * - closed：计数 +1，达阈值 → 开闸；
   * - half-open：仅匹配令牌的探测失败 → 回 open 并重新计时；令牌不匹配/缺失忽略；
   * - open：陈旧失败忽略。
   */
  recordFailure(probeToken?: number): void {
    if (this.state === "half-open") {
      if (!this.isActiveProbe(probeToken)) return;
      this.clearProbe();
      this.reopen();
      return;
    }
    if (this.state === "closed") {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.reopen();
      }
    }
  }

  private beginProbe(): number {
    this.probeEpoch += 1;
    this.activeProbeToken = this.probeEpoch;
    this.probeInFlight = true;
    return this.activeProbeToken;
  }

  private isActiveProbe(probeToken?: number): boolean {
    return (
      this.probeInFlight &&
      this.activeProbeToken !== null &&
      probeToken !== undefined &&
      probeToken === this.activeProbeToken
    );
  }

  private clearProbe(): void {
    this.probeInFlight = false;
    this.activeProbeToken = null;
  }

  private reopen(): void {
    if (this.transition("open")) {
      this.openedAt = this.now();
    }
  }
}
