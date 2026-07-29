/**
 * 重新生成 contextHooks.equivalence.json（WEB_TOOL_GUIDE 等文案变更后跑一次）。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/regen-contextHooks-fixture.ts
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  __resetContextHooksForTests,
  ensureBuiltinContextHooks,
  runContextHooks,
  type ContextHookInput,
} from "../infra/contextHooks.js";
import { buildAgentToolGuide, buildTierIdentityHint } from "../infra/promptBuilder.js";
import type { NativeToolContext } from "../infra/tools/native/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../__tests__/fixtures/contextHooks.equivalence.json");

type Fixture = {
  id: string;
  basePrompt?: string;
  tools: string[];
  memoryHint: string;
  identity: { tier: string | null; name: string | null };
  systemPrompt: string;
  identityHint?: string;
  toolGuide?: string;
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
    messages: [
      { role: "system", content: "你是 KnowPilot 助手。" },
      { role: "user", content: "触发检索的用户问题" },
    ],
    systemPrompt: "你是 KnowPilot 助手。",
    ctx: makeCtx(),
    scratch: {},
    ...overrides,
  };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture[];
  __resetContextHooksForTests({ registerBuiltins: true });
  ensureBuiltinContextHooks();

  for (const f of fixtures) {
    const base = f.basePrompt || "你是 KnowPilot 助手。";
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
          name: f.identity.name as string,
          tier: f.identity.tier as "super" | "manager" | "sub",
          tools: f.tools,
          systemPrompt: base,
        },
        scratch: { __testMemoryHint: f.memoryHint },
      }),
    );
    f.systemPrompt = out.systemPrompt;
    if ("toolGuide" in f) {
      f.toolGuide = buildAgentToolGuide(f.tools || []);
    }
    if ("identityHint" in f) {
      f.identityHint = buildTierIdentityHint(
        f.identity.tier as "super" | "manager" | "sub" | null,
        f.identity.name,
      );
    }
  }

  writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2) + "\n", "utf-8");
  console.log(`updated ${fixtures.length} fixtures → ${fixturePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
