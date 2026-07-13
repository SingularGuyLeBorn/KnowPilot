/**
 * AgentRunPhase 状态机 + 统一 loop 契约单测
 */

import { describe, it, expect } from "vitest";
import { createPhaseMachine } from "../infra/loop/phase.js";
import { partitionToolCallsByBudget } from "../infra/agentTools.js";
import type { LlmToolCall } from "../infra/llmClient.js";

describe("createPhaseMachine", () => {
  it("允许合法转移 idle→compacting→llm→tool_batch→llm→done", () => {
    const m = createPhaseMachine();
    expect(m.phase).toBe("idle");
    m.transition("compacting");
    m.transition("llm");
    m.transition("tool_batch");
    m.transition("llm");
    m.transition("done");
    expect(m.phase).toBe("done");
  });

  it("允许预算耗尽路径 llm→synthesizing→done", () => {
    const m = createPhaseMachine();
    m.transition("llm");
    m.transition("synthesizing");
    m.transition("done");
    expect(m.phase).toBe("done");
  });

  it("非法转移抛错", () => {
    const m = createPhaseMachine();
    m.transition("llm");
    expect(() => m.transition("compacting")).toThrow(/非法转移/);
  });

  it("同相 no-op", () => {
    const m = createPhaseMachine();
    m.transition("llm");
    m.transition("llm");
    expect(m.phase).toBe("llm");
  });

  it("onPhase 回调按顺序触发", () => {
    const log: string[] = [];
    const m = createPhaseMachine((to, from) => log.push(`${from}->${to}`));
    m.transition("compacting");
    m.transition("llm");
    expect(log).toEqual(["idle->compacting", "compacting->llm"]);
  });
});

describe("budget + phase 契约（文档级）", () => {
  it("预算切分与 phase 检查点语义一致：先切分再执行", () => {
    const calls: LlmToolCall[] = [1, 2, 3].map((i) => ({
      id: `c${i}`,
      type: "function",
      function: { name: "web_search", arguments: "{}" },
    }));
    // 已用 2，上限 3 → 只能再跑 1 个
    const { runnable, deferred } = partitionToolCallsByBudget(calls, 2, 3);
    expect(runnable).toHaveLength(1);
    expect(deferred).toHaveLength(2);
    // 执行完 runnable 后 used=3 → 应进入 synthesizing（由 reactLoop 强制）
    const usedAfter = 2 + runnable.length;
    expect(usedAfter).toBe(3);
  });
});
