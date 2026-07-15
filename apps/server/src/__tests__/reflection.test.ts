/**
 * W7 反思装饰器 withReflection 单测
 *
 * 覆盖（验收标准）：
 * 1. critic 通过 → 原样返回（无标记、不重试）
 * 2. critic 不通过 → 意见经 injectUserMessages 回注，loop 重走一轮
 * 3. 反思轮数耗尽 → 带 [未经反思通过] 标记放行（不阻断用户）
 * 4. critic 抛错 → 静默跳过，不影响主链路
 * 5. enabled=false（默认）→ 装饰器直返，critic 零调用
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runReactLoop } from "../infra/loop/reactLoop.js";
import { withReflection, REFLECTION_UNPASSED_MARK } from "../infra/loop/reflection.js";
import type { LlmTransport, ReactLoopInput } from "../infra/loop/types.js";
import * as llmClient from "../infra/llmClient.js";
import type { LlmMessage } from "../infra/llmClient.js";
import { runAgentLoopStream, type AgentStreamEvent } from "../infra/agentStream.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

/** 脚本化 transport：按序返回内容，并记录每次 complete 收到的 messages */
function scriptedTransport(steps: Array<{ content?: string; throwError?: string }>) {
  const calls: LlmMessage[][] = [];
  let i = 0;
  const transport: LlmTransport = {
    async complete({ messages }) {
      calls.push([...messages]);
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step.throwError) throw new Error(step.throwError);
      return {
        content: step.content ?? "",
        toolCalls: [],
        model: "test-model",
        provider: "test",
      };
    },
  };
  return { transport, calls };
}

function stubServices(): ServiceContainer {
  return { run: { create: vi.fn(async () => ({ success: true, data: { id: "run-stub" } })) } } as unknown as ServiceContainer;
}

describe("W7 反思装饰器 withReflection", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function loopInput(
    main: LlmTransport,
    opts: { enabled?: boolean; maxRounds?: number; critic: LlmTransport },
    hooks?: ReactLoopInput["hooks"],
  ): ReactLoopInput {
    const config = createTestConfig(root);
    return {
      config,
      services: stubServices(),
      agent: { model: "test-model", systemPrompt: "", tools: [] },
      messages: [{ role: "user", content: "写一篇对比分析" }],
      invokeTrpc: async () => ({}),
      transport: withReflection(main, {
        enabled: opts.enabled ?? true,
        maxRounds: opts.maxRounds ?? 1,
        criticModel: "test-critic-model",
        config,
        criticTransport: opts.critic,
      }),
      hooks,
      runOrigin: "user",
    };
  }

  it("critic 通过 → 原样返回（无标记、不重试）", async () => {
    const main = scriptedTransport([{ content: "最终答案" }]);
    const critic = scriptedTransport([{ content: '{"passed": true, "issues": []}' }]);

    const result = await runReactLoop(loopInput(main.transport, { critic: critic.transport }));

    expect(result.content).toBe("最终答案");
    expect(result.content).not.toContain(REFLECTION_UNPASSED_MARK);
    expect(result.roundsUsed).toBe(1);
    expect(main.calls).toHaveLength(1);
    expect(critic.calls).toHaveLength(1);
  });

  it("critic 不通过 → 意见经 injectUserMessages 回注，loop 重走一轮", async () => {
    const main = scriptedTransport([{ content: "草稿 v1" }, { content: "修订版 v2" }]);
    const critic = scriptedTransport([
      { content: '{"passed": false, "issues": ["遗漏了用户要求的对比表格"]}' },
      { content: '{"passed": true, "issues": []}' },
    ]);
    const onInjected = vi.fn();

    const result = await runReactLoop(
      loopInput(main.transport, { critic: critic.transport }, { onInjected }),
    );

    expect(result.content).toBe("修订版 v2");
    expect(result.roundsUsed).toBe(2);
    expect(main.calls).toHaveLength(2);
    expect(critic.calls).toHaveLength(2);
    // 回注走的是既有 injectUserMessages 显式机制（kind=follow_up）
    expect(onInjected).toHaveBeenCalledTimes(1);
    expect(onInjected.mock.calls[0][0]).toMatchObject({ kind: "follow_up" });
    // 第二轮 messages：被拒终稿以 assistant 入列，critic 意见以 user 消息回注
    const secondRound = main.calls[1];
    const assistantDraft = secondRound.find((m) => m.role === "assistant" && m.content === "草稿 v1");
    expect(assistantDraft).toBeDefined();
    const feedbackMsg = secondRound.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("遗漏了用户要求的对比表格"),
    );
    expect(feedbackMsg).toBeDefined();
  });

  it("反思轮数耗尽 → 带 [未经反思通过] 标记放行（不阻断用户）", async () => {
    const main = scriptedTransport([{ content: "草稿 v1" }, { content: "修订版 v2" }]);
    const critic = scriptedTransport([
      { content: '{"passed": false, "issues": ["问题仍在"]}' }, // 脚本化 transport 重复返回末步 → 一直不通过
    ]);

    const result = await runReactLoop(
      loopInput(main.transport, { critic: critic.transport, maxRounds: 1 }),
    );

    // 第 1 轮不通过 → 回注重修（1/1）；第 2 轮仍不通过 → 轮数耗尽，标记放行
    expect(main.calls).toHaveLength(2);
    expect(critic.calls).toHaveLength(2);
    expect(result.content.startsWith(REFLECTION_UNPASSED_MARK)).toBe(true);
    expect(result.content).toContain("修订版 v2");
  });

  it("critic 抛错 → 静默跳过，不影响主链路", async () => {
    const main = scriptedTransport([{ content: "最终答案" }]);
    const critic = scriptedTransport([{ throwError: "critic boom" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runReactLoop(loopInput(main.transport, { critic: critic.transport }));

    expect(result.content).toBe("最终答案");
    expect(result.content).not.toContain(REFLECTION_UNPASSED_MARK);
    expect(main.calls).toHaveLength(1);
    expect(critic.calls).toHaveLength(1);
    warn.mockRestore();
  });

  it("enabled=false（默认）→ 装饰器直返，critic 零调用", async () => {
    const main = scriptedTransport([{ content: "最终答案" }]);
    const critic = scriptedTransport([{ content: '{"passed": false, "issues": ["不该被调用"]}' }]);

    const result = await runReactLoop(
      loopInput(main.transport, { critic: critic.transport, enabled: false }),
    );

    expect(result.content).toBe("最终答案");
    expect(critic.calls).toHaveLength(0);
  });

  it("onReflection 显式事件：critic 恒不通过 → retry → marked 各一次", async () => {
    const main = scriptedTransport([{ content: "草稿 v1" }, { content: "修订版 v2" }]);
    const critic = scriptedTransport([{ content: '{"passed": false, "issues": ["问题仍在"]}' }]);
    const onReflection = vi.fn();

    const result = await runReactLoop(
      loopInput(main.transport, { critic: critic.transport, maxRounds: 1 }, { onReflection }),
    );

    expect(result.content.startsWith(REFLECTION_UNPASSED_MARK)).toBe(true);
    expect(onReflection).toHaveBeenCalledTimes(2);
    expect(onReflection.mock.calls.map((c) => c[0])).toEqual([
      { round: 1, issues: ["问题仍在"], action: "retry" },
      { round: 2, issues: ["问题仍在"], action: "marked" },
    ]);
  });

  it("stream 形态：followUp 抢先续轮时 verdict 不消费（无反思回注、无 onReflection）", async () => {
    const main = scriptedTransport([{ content: "草稿" }, { content: "后续回答" }]);
    const critic = scriptedTransport([
      { content: '{"passed": false, "issues": ["不该被消费"]}' }, // 草稿轮的 verdict 被 followUp 抢先，丢弃
      { content: '{"passed": true, "issues": []}' }, // 新终轮正常过 critic
    ]);
    const onReflection = vi.fn();
    const onInjected = vi.fn();
    let followUps = [{ id: "fu_1", content: "补充一个问题" }];

    const input = loopInput(main.transport, { critic: critic.transport }, { onReflection, onInjected });
    input.runQueues = {
      takeFollowUp: () => {
        const items = followUps;
        followUps = [];
        return items;
      },
      takeSteer: () => [],
    };

    const result = await runReactLoop(input);

    expect(result.content).toBe("后续回答");
    expect(main.calls).toHaveLength(2);
    expect(critic.calls).toHaveLength(2); // 两个终轮各一票（草稿轮白跑，见 reflection.ts 注释）
    expect(onReflection).not.toHaveBeenCalled(); // verdict 未被消费 → 无事件
    expect(onInjected).toHaveBeenCalledTimes(1); // 只有真实 followUp 注入，无反思回注
    expect(onInjected.mock.calls[0][0]).toMatchObject({ kind: "follow_up", content: "补充一个问题" });
  });
});

/* ─────────────── W16d-1：stream 链路接入点（runAgentLoopStream 端到端） ─────────────── */

describe("W16d-1 stream 链路反思接入（runAgentLoopStream）", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("开启反思后 stream 全覆盖：草稿被 critic 拒 → reflection SSE + 回注重修 → 终稿放行", async () => {
    // 主链路走 chatCompletionStream（spy 模块命名空间委托，见 transports.ts 注释）
    const drafts = ["草稿 v1", "修订版 v2"];
    let streamCall = 0;
    const streamSpy = vi.spyOn(llmClient, "chatCompletionStream").mockImplementation(async function* () {
      const text = drafts[Math.min(streamCall++, drafts.length - 1)];
      yield { type: "token", delta: text };
    });
    // critic 走 chatCompletion（createSyncTransport → W2 弹性客户端 → llmClient）
    const verdicts = [
      { passed: false, issues: ["遗漏了用户要求的对比表格"] },
      { passed: true, issues: [] },
    ];
    let criticCall = 0;
    const completionSpy = vi.spyOn(llmClient, "chatCompletion").mockImplementation(async () => {
      const v = verdicts[Math.min(criticCall++, verdicts.length - 1)];
      return {
        content: JSON.stringify(v),
        reasoningContent: null,
        toolCalls: [],
        finishReason: "stop",
        model: "critic-model",
        provider: "test",
      };
    });

    const config = createTestConfig(root, {
      reflection: { enabled: true, maxRounds: 1, criticModel: "" },
    });
    const events: AgentStreamEvent[] = [];

    const result = await runAgentLoopStream({
      config,
      services: stubServices(),
      agent: { model: "test-model", systemPrompt: "", tools: [] },
      messages: [{ role: "user", content: "写一篇对比分析" }],
      llmOptions: {},
      invokeTrpc: async () => ({}),
      emit: (e) => events.push(e),
    });

    // 主链路两轮：草稿被拒 → 回注重修 → 终稿
    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(completionSpy).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("修订版 v2");
    // 被拒草稿先进时间线（intermediate_content），随后 reflection SSE 透传 verdict
    expect(events.some((e) => e.type === "intermediate_content" && e.content === "草稿 v1")).toBe(true);
    const reflectionEvents = events.filter((e) => e.type === "reflection");
    expect(reflectionEvents).toEqual([
      { type: "reflection", round: 1, issues: ["遗漏了用户要求的对比表格"], action: "retry" },
    ]);
  });

  it("默认关闭（enabled=false）→ stream 链路零反思：critic 零调用、无 reflection 事件", async () => {
    const streamSpy = vi.spyOn(llmClient, "chatCompletionStream").mockImplementation(async function* () {
      yield { type: "token", delta: "最终答案" };
    });
    const completionSpy = vi.spyOn(llmClient, "chatCompletion");

    const config = createTestConfig(root); // reflection.enabled 默认 false
    const events: AgentStreamEvent[] = [];

    const result = await runAgentLoopStream({
      config,
      services: stubServices(),
      agent: { model: "test-model", systemPrompt: "", tools: [] },
      messages: [{ role: "user", content: "你好" }],
      llmOptions: {},
      invokeTrpc: async () => ({}),
      emit: (e) => events.push(e),
    });

    expect(result.content).toBe("最终答案");
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(completionSpy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "reflection")).toBe(false);
  });
});
