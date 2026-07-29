/**
 * 按当前 promptBuilder / contextHooks 内建钩子重写 equivalence fixture。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/regen-contextHooks-fixture.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  runContextHooks,
  ensureBuiltinContextHooks,
  __resetContextHooksForTests,
  type ContextHookInput,
} from "../infra/contextHooks.js";
import type { LlmMessage } from "../infra/llmClient.js";
import type { NativeToolContext } from "../infra/tools/native/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../__tests__/fixtures/contextHooks.equivalence.json");

type Fixture = {
  id: string;
  basePrompt: string;
  tools: string[];
  memoryHint: string;
  identity: { tier: string | null; name: string | null };
  systemPrompt: string;
  identityHint: string;
  toolGuide: string;
};

function makeCtx(): NativeToolContext {
  return {
    config: {} as NativeToolContext["config"],
    services: {
      prisma: {
        agent: { findUnique: async () => null },
      },
    } as unknown as NativeToolContext["services"],
    invokeTrpc: async () => null,
  };
}

function makeInput(overrides?: Partial<ContextHookInput>): ContextHookInput {
  const messages: LlmMessage[] = [
    { role: "system", content: "你是 KnowPilot 助手。" },
    { role: "user", content: "触发检索的用户问题" },
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

async function main() {
  __resetContextHooksForTests({ registerBuiltins: false });
  ensureBuiltinContextHooks();

  const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as Fixture[];
  const next: Fixture[] = [];

  for (const f of fixtures) {
    const base = f.basePrompt || "你是 KnowPilot 助手。";
    const scratch: Record<string, unknown> = { __testMemoryHint: f.memoryHint };
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
          name: f.identity.name as unknown as string,
          tier: f.identity.tier as unknown as "super" | "manager" | "sub",
          tools: f.tools,
          systemPrompt: base,
        },
        scratch,
      }),
    );

    next.push({
      ...f,
      systemPrompt: out.systemPrompt,
      identityHint: String(scratch.__identityHint ?? ""),
      toolGuide: String(scratch.__toolGuide ?? ""),
    });
  }

  fs.writeFileSync(fixturePath, JSON.stringify(next, null, 2) + "\n", "utf-8");
  console.log(`rewrote ${next.length} fixtures → ${fixturePath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
