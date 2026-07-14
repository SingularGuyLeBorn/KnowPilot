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
import type { LlmMessage } from "../infra/llmClient.js";
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
});
