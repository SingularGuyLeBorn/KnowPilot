import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import { flushMemoriesBeforeCompact } from "../infra/memoryFlush.js";
import * as llmClient from "../infra/llmClient.js";

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

  it("从 transcript 提取事实并写入 Memory", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: `[{"content":"用户偏好莫兰迪色系","type":"preference","keywords":["design","color"]}]`,
    } as any);
    const services = makeServices();
    const config = {
      compact: { memoryFlush: { enabled: true, maxFacts: 5 } },
    } as AppConfig;
    const n = await flushMemoriesBeforeCompact(config, services as any, "用户说喜欢莫兰迪色", "m");
    expect(n).toBe(1);
    expect(services.memory.create).toHaveBeenCalledOnce();
  });

  it("memoryFlush 关闭时跳过", async () => {
    const spy = vi.spyOn(llmClient, "chatCompletion");
    const services = makeServices();
    const config = {
      compact: { memoryFlush: { enabled: false, maxFacts: 5 } },
    } as AppConfig;
    const n = await flushMemoriesBeforeCompact(config, services as any, "test", "m");
    expect(n).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
