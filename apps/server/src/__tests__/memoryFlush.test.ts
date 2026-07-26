import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import type { AppConfig } from "../infra/config.js";
import { flushMemoriesBeforeCompact } from "../infra/memoryFlush.js";
import * as resilientLlmClient from "../infra/resilientLlmClient.js";

/** 隔离的临时 projectRoot，避免 memoryDaily 把 daily note 写进工作树（污染 apps/server/config/） */
function tmpProjectRoot(): string {
  const dir = path.join(os.tmpdir(), `kp-memflush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeServices() {
  const items: Array<{ content: string; type: string; strength: number; keywords: string[] }> = [];
  return {
    // W5：flush 改走 MemoryRepository（dedupe 查 contentHash，写入仍经 MemoryService.create）
    prisma: {
      memory: {
        findFirst: vi.fn(async () => null),
      },
    },
    memory: {
      create: vi.fn(async (input: { content: string; type: string; strength: number; keywords: string[] }) => {
        items.push(input);
        return { success: true, data: { id: `mem_${items.length}`, ...input } };
      }),
    },
    _items: items,
  };
}

describe("memoryFlush", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("从 transcript 提取事实并写入 Memory（有 Agent 时写 agent scope）", async () => {
    // P2-02：memoryFlush 改走 resilientChatCompletion，spy 目标迁移。
    vi.spyOn(resilientLlmClient, "resilientChatCompletion").mockResolvedValue({
      content: `[{"content":"用户偏好莫兰迪色系","type":"preference","keywords":["design","color"]}]`,
    } as any);
    const services = makeServices();
    const config = {
      projectRoot: tmpProjectRoot(),
      compact: { memoryFlush: { enabled: true, maxFacts: 5 } },
    } as AppConfig;
    const n = await flushMemoriesBeforeCompact(config, services as any, "用户说喜欢莫兰迪色", "m", {
      actor: { agentId: "agent_flush_1", workspaceId: "ws1", tier: "manager" },
    });
    expect(n).toBe(1);
    expect(services.memory.create).toHaveBeenCalledOnce();
    const arg = services.memory.create.mock.calls[0][0] as { scope?: string };
    expect(arg.scope).toBe("agent:agent_flush_1");
  });

  it("memoryFlush 关闭时跳过", async () => {
    const spy = vi.spyOn(resilientLlmClient, "resilientChatCompletion");
    const services = makeServices();
    const config = {
      compact: { memoryFlush: { enabled: false, maxFacts: 5 } },
    } as AppConfig;
    const n = await flushMemoriesBeforeCompact(config, services as any, "test", "m");
    expect(n).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
