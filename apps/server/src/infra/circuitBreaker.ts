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
 * - open 期间到达的陈旧 recordSuccess/recordFailure（在途请求晚完成）不改变状态，
 *   事件级「非法转移」同样被拒——成功不能提前合闸，失败不重复计时（避免并发失败无限推迟恢复）；
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

export type CircuitPermit = { allowed: true } | { allowed: false; retryAfterMs: number };

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
   * - closed：放行；
   * - open：冷却未到期拒绝（附 retryAfterMs）；到期转 half-open 并放行唯一探测；
   * - half-open：无探测在途则放行探测，否则拒绝（并发探测不许都放过去）。
   */
  tryAcquire(): CircuitPermit {
    if (this.state === "closed") return { allowed: true };

    if (this.state === "open") {
      const elapsed = this.now() - this.openedAt;
      if (elapsed < this.openDurationMs) {
        return { allowed: false, retryAfterMs: this.openDurationMs - elapsed };
      }
      // 冷却到期 → half-open，本调用即探测
      if (this.transition("half-open")) {
        this.probeInFlight = true;
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: this.openDurationMs };
    }

    // half-open
    if (this.probeInFlight) {
      return { allowed: false, retryAfterMs: this.openDurationMs };
    }
    this.probeInFlight = true;
    return { allowed: true };
  }

  /**
   * 记录成功：
   * - closed：失败计数清零；
   * - half-open：探测成功 → 合闸 closed，计数清零；
   * - open：在途陈旧完成——开闸期间的成功不提前合闸（必须经半开探测），忽略。
   */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.probeInFlight = false;
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
   * - closed：计数 +1，达阈值 → 开闸 open；
   * - half-open：探测失败 → 回 open 并重新计时；
   * - open：在途陈旧失败——已开闸，忽略（不推迟恢复时间）。
   */
  recordFailure(): void {
    if (this.state === "half-open") {
      this.probeInFlight = false;
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

  private reopen(): void {
    if (this.transition("open")) {
      this.openedAt = this.now();
    }
  }
}
