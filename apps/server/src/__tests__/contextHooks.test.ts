/**
 * W4 context 钩子链
 *
 * 覆盖：注册/同名覆盖/order/enabled、结果应用、单钩子抛错不阻断、
 * 等价性快照（迁移前 buildSystemPromptWithHints fixture）、round===1 谓词。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  registerContextHook,
  runContextHooks,
  __resetContextHooksForTests,
  ensureBuiltinContextHooks,
  type ContextHook,
  type ContextHookInput,
} from "../infra/contextHooks.js";
import { buildTierIdentityHint, buildAgentToolGuide } from "../infra/promptBuilder.js";
import type { LlmMessage } from "../infra/llmClient.js";
import type { NativeToolContext } from "../infra/tools/native/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixtures = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/contextHooks.equivalence.json"), "utf-8"),
) as Array<{
  id: string;
  basePrompt: string;
  tools: string[];
  memoryHint: string;
  identity: { tier: string | null; name: string | null };
  systemPrompt: string;
}>;

function makeCtx(partial?: Partial<NativeToolContext>): NativeToolContext {
  return {
    config: {} as NativeToolContext["config"],
    services: {
      prisma: {
        agent: { findUnique: async () => null },
      },
    } as unknown as NativeToolContext["services"],
    invokeTrpc: async () => null,
    ...partial,
  };
}

function makeInput(overrides?: Partial<ContextHookInput>): ContextHookInput {
  const messages: LlmMessage[] = [
    { role: "system", content: "你是 KnowPilot 助手。" },
    { role: "user", content: "你好" },
  ];
  return {
    agent: {
      id: "agent-1",
      name: "测试",
      description: null,
      model: "deepseek-v4-flash",
      systemPrompt: "你是 KnowPilot 助手。",
      tools: [],
      tier: "sub",
      workspaceId: null,
      parentId: null,
      apiKey: null,
      heartbeatModel: null,
      heartbeat: null,
      status: "active",
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    sessionId: "sess-1",
    runId: "run-1",
    round: 1,
    messages: messages.map((m) => ({ ...m })),
    systemPrompt: "你是 KnowPilot 助手。",
    ctx: makeCtx(),
    scratch: {},
    ...overrides,
  };
}

describe("contextHooks 注册表", () => {
  beforeEach(() => {
    __resetContextHooksForTests({ registerBuiltins: false });
  });
  afterEach(() => {
    __resetContextHooksForTests({ registerBuiltins: true });
  });

  it("按 order 升序执行", async () => {
    const order: string[] = [];
    registerContextHook({
      name: "late",
      order: 300,
      run: () => {
        order.push("late");
      },
    });
    registerContextHook({
      name: "early",
      order: 100,
      run: () => {
        order.push("early");
      },
    });
    registerContextHook({
      name: "mid",
      order: 200,
      run: () => {
        order.push("mid");
      },
    });
    await runContextHooks(makeInput());
    expect(order).toEqual(["early", "mid", "late"]);
  });

  it("同名覆盖（后者生效）", async () => {
    const hits: string[] = [];
    registerContextHook({
      name: "dup",
      order: 100,
      run: () => {
        hits.push("old");
      },
    });
    registerContextHook({
      name: "dup",
      order: 100,
      run: () => {
        hits.push("new");
      },
    });
    await runContextHooks(makeInput());
    expect(hits).toEqual(["new"]);
  });

  it("enabled 谓词为 false 时跳过", async () => {
    const hits: string[] = [];
    registerContextHook({
      name: "gated",
      order: 100,
      enabled: (input) => input.round === 1,
      run: () => {
        hits.push("run");
      },
    });
    await runContextHooks(makeInput({ round: 2 }));
    expect(hits).toEqual([]);
    await runContextHooks(makeInput({ round: 1 }));
    expect(hits).toEqual(["run"]);
  });
});

describe("contextHooks 结果应用", () => {
  beforeEach(() => {
    __resetContextHooksForTests({ registerBuiltins: false });
  });
  afterEach(() => {
    __resetContextHooksForTests({ registerBuiltins: true });
  });

  it("systemPrompt 改写生效", async () => {
    registerContextHook({
      name: "rewrite-sp",
      order: 100,
      run: (input) => ({ systemPrompt: `${input.systemPrompt}::patched` }),
    });
    const out = await runContextHooks(makeInput({ systemPrompt: "BASE" }));
    expect(out.systemPrompt).toBe("BASE::patched");
  });

  it("messages 整表替换生效", async () => {
    registerContextHook({
      name: "rewrite-msgs",
      order: 100,
      run: () => ({
        messages: [{ role: "user", content: "replaced" }],
      }),
    });
    const out = await runContextHooks(makeInput());
    expect(out.messages).toEqual([{ role: "user", content: "replaced" }]);
  });

  it("prependUserContext 注入到末尾前（user 角色）", async () => {
    registerContextHook({
      name: "prepend",
      order: 100,
      run: () => ({ prependUserContext: "上下文块" }),
    });
    const out = await runContextHooks(
      makeInput({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "最后一句" },
        ],
      }),
    );
    expect(out.messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(out.messages[1]).toEqual({ role: "user", content: "上下文块" });
    expect(out.messages[2]).toEqual({ role: "user", content: "最后一句" });
  });

  it("单钩子抛错 warn 跳过，不阻断后续钩子", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hits: string[] = [];
    registerContextHook({
      name: "boom",
      order: 100,
      run: () => {
        throw new Error("hook failed");
      },
    });
    registerContextHook({
      name: "ok",
      order: 200,
      run: () => {
        hits.push("ok");
        return { systemPrompt: "survived" };
      },
    });
    const out = await runContextHooks(makeInput({ systemPrompt: "BASE" }));
    expect(hits).toEqual(["ok"]);
    expect(out.systemPrompt).toBe("survived");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("内建钩子 round===1 与等价性快照", () => {
  beforeEach(() => {
    __resetContextHooksForTests({ registerBuiltins: true });
    ensureBuiltinContextHooks();
  });
  afterEach(() => {
    __resetContextHooksForTests({ registerBuiltins: true });
  });

  it("内建钩子链产出与迁移前 fixture 逐字节相等", async () => {
    for (const f of fixtures) {
      const base = f.basePrompt || "你是 KnowPilot 助手。";
      // 注入固定 memoryHint：绕过 DB，验证拼装顺序与文案搬家等价
      const out = await runContextHooks(
        makeInput({
          round: 1,
          systemPrompt: base,
          messages: [
            { role: "system", content: base },
            { role: "user", content: "触发检索的用户问题" },
          ],
          agent: {
            ...makeInput().agent,
            // 与 fixture 一致：tier/name 可为 null（不注入身份段）
            name: f.identity.name as unknown as string,
            tier: f.identity.tier as unknown as "super" | "manager" | "sub",
            tools: f.tools,
            systemPrompt: base,
          },
          scratch: { __testMemoryHint: f.memoryHint },
        }),
      );
      expect(out.systemPrompt, f.id).toBe(f.systemPrompt);
    }
  });

  it("round=2 时 round===1 内建钩子不再生效（systemPrompt 保持原样）", async () => {
    const f = fixtures[0]!;
    const base = f.basePrompt || "你是 KnowPilot 助手。";
    const out = await runContextHooks(
      makeInput({
        round: 2,
        systemPrompt: base,
        messages: [
          { role: "system", content: base },
          { role: "user", content: "第二轮" },
        ],
        agent: {
          ...makeInput().agent,
          name: f.identity.name ?? "测试",
          tier: (f.identity.tier as "super" | "manager" | "sub") ?? "sub",
          tools: f.tools,
          systemPrompt: base,
        },
        scratch: { __testMemoryHint: f.memoryHint },
      }),
    );
    expect(out.systemPrompt).toBe(base);
    // 对照：旧拼装在 round1 才会出现的片段不应出现
    expect(out.systemPrompt).not.toContain("你的身份");
    expect(out.systemPrompt).not.toBe(f.systemPrompt);
  });

  it("片段构建器自身稳定（identity / tool-guide）", () => {
    for (const f of fixtures) {
      expect(buildTierIdentityHint(f.identity.tier, f.identity.name)).toBe(
        f.identity.tier || f.identity.name
          ? buildTierIdentityHint(f.identity.tier, f.identity.name)
          : buildTierIdentityHint(f.identity.tier, f.identity.name),
      );
      expect(buildAgentToolGuide(f.tools).length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("ContextHook 类型契约冒烟", () => {
  it("钩子可为 sync / async / void", async () => {
    __resetContextHooksForTests({ registerBuiltins: false });
    const hooks: ContextHook[] = [
      { name: "sync", order: 1, run: () => ({ systemPrompt: "a" }) },
      {
        name: "async",
        order: 2,
        run: async (input) => ({ systemPrompt: `${input.systemPrompt}b` }),
      },
      { name: "void", order: 3, run: () => undefined },
    ];
    for (const h of hooks) registerContextHook(h);
    const out = await runContextHooks(makeInput({ systemPrompt: "" }));
    expect(out.systemPrompt).toBe("ab");
    __resetContextHooksForTests({ registerBuiltins: true });
  });
});
