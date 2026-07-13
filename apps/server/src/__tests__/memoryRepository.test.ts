/**
 * MemoryRepository 测试（W5）
 *
 * 覆盖：
 * 1. scope 隔离：agent:A 的经验/记忆不出现在 agent:B 的 context（写时隔离）
 * 2. contentHash 去重：同 scope 同内容幂等刷新，不产生重复行
 * 3. strength 衰减：decayMemories 按日复利衰减，低分归档删除
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { getEventBus } from "../infra/eventBus.js";
import { getAppConfig } from "../infra/config.js";
import { getServiceContainer, type ServiceContainer } from "../infra/serviceContainer.js";
import {
  createMemoryRepository,
  decayMemories,
  hashMemoryContent,
  type MemoryRepository,
} from "../infra/memoryRepository.js";
import { buildMemoryContext } from "../infra/promptBuilder.js";
import {
  MEMORY_ARCHIVE_THRESHOLD,
  MEMORY_DECAY_FACTOR_PER_DAY,
  MEMORY_TYPES,
  memoryAgentScope,
} from "@knowpilot/shared";

const RUN = `w5test-${Date.now()}`;
const DAY_MS = 86_400_000;

describe("MemoryRepository（W5）", () => {
  let services: ServiceContainer;
  let repo: MemoryRepository;
  const createdIds: string[] = [];

  beforeAll(() => {
    services = getServiceContainer(prisma, getEventBus(), getAppConfig());
    repo = createMemoryRepository(services);
  });

  afterAll(async () => {
    // 走 MemoryService.delete 清理 DB + content/ 文件 + FTS 行
    for (const id of createdIds) {
      await services.memory.delete(id).catch(() => undefined);
    }
  });

  async function track(item: { id: string }) {
    createdIds.push(item.id);
    return item;
  }

  it("scope 隔离：agent:A 的记忆不出现在 agent:B 的 context，global 双方可见", async () => {
    const agentA = `${RUN}-agentA`;
    const agentB = `${RUN}-agentB`;
    const tokenA = `${RUN}-private-token-A`;
    const tokenGlobal = `${RUN}-global-token`;

    await track(
      await repo.write({
        content: `Agent A 的私有语义记忆 ${tokenA}`,
        type: MEMORY_TYPES.SEMANTIC,
        scope: memoryAgentScope(agentA),
        keywords: [tokenA],
      }),
    );
    await track(
      await repo.write({
        content: `全局共享记忆 ${tokenGlobal}`,
        type: MEMORY_TYPES.SEMANTIC,
        scope: "global",
        keywords: [tokenGlobal],
      }),
    );

    // B 的 context：看不到 A 的私有记忆
    const ctxB = await buildMemoryContext(services, tokenA, { agentId: agentB });
    expect(ctxB.includes(tokenA)).toBe(false);

    // A 的 context：能看到自己的私有记忆
    const ctxA = await buildMemoryContext(services, tokenA, { agentId: agentA });
    expect(ctxA.includes(tokenA)).toBe(true);

    // global 记忆双方可见
    const ctxBGlobal = await buildMemoryContext(services, tokenGlobal, { agentId: agentB });
    expect(ctxBGlobal.includes(tokenGlobal)).toBe(true);
  });

  it("experience 写时隔离：A 的经验即使指定 A 也不注入（type 过滤），B 更不可见", async () => {
    const agentA = `${RUN}-expA`;
    const agentB = `${RUN}-expB`;
    const token = `${RUN}-exp-token`;

    await track(
      await repo.write({
        content: JSON.stringify({ taskDescription: `经验 ${token}`, success: true, toolsUsed: [] }),
        type: MEMORY_TYPES.EXPERIENCE,
        scope: memoryAgentScope(agentA),
        keywords: [token],
      }),
    );

    // experience 不属于 injectable 类型，即使读方是 A 本人也不注入 prompt
    const ctxA = await buildMemoryContext(services, token, { agentId: agentA });
    expect(ctxA.includes(token)).toBe(false);
    const ctxB = await buildMemoryContext(services, token, { agentId: agentB });
    expect(ctxB.includes(token)).toBe(false);

    // 但仓储显式读 experience 时按 scope 隔离：A 可见、B 不可见
    const readA = await repo.read({ types: [MEMORY_TYPES.EXPERIENCE], scopes: [memoryAgentScope(agentA)], keyword: token });
    expect(readA.some((m) => m.content.includes(token))).toBe(true);
    const readB = await repo.read({ types: [MEMORY_TYPES.EXPERIENCE], scopes: [memoryAgentScope(agentB)], keyword: token });
    expect(readB.some((m) => m.content.includes(token))).toBe(false);
  });

  it("contentHash 去重：同 scope 同内容幂等刷新，不产生重复行", async () => {
    const token = `${RUN}-dedupe-token`;
    const content = `去重测试记忆 ${token}`;
    const first = await track(
      await repo.write({ content, type: MEMORY_TYPES.NOTE, scope: "global", strength: 0.5, keywords: [token] }),
    );
    // 同内容再写（更高强度）→ 应刷新同一行而非新建
    const second = await repo.write({ content, type: MEMORY_TYPES.NOTE, scope: "global", strength: 0.9, keywords: [token] });
    expect(second.id).toBe(first.id);
    expect(second.strength).toBe(0.9);

    const rows = await prisma.memory.findMany({ where: { contentHash: hashMemoryContent(content) } });
    expect(rows.length).toBe(1);

    // 内容不同 → hash 不同 → 新行
    const other = await track(
      await repo.write({ content: `${content}（变体）`, type: MEMORY_TYPES.NOTE, scope: "global", keywords: [token] }),
    );
    expect(other.id).not.toBe(first.id);
  });

  it("decayMemories：按日复利衰减且不动 updatedAt，低于阈值归档删除", async () => {
    const token = `${RUN}-decay-token`;
    const item = await track(
      await repo.write({ content: `衰减测试 ${token}`, type: MEMORY_TYPES.NOTE, scope: "global", strength: 1.0, keywords: [token] }),
    );
    const before = await prisma.memory.findUnique({ where: { id: item.id } });
    expect(before).not.toBeNull();

    // 模拟 10 天后执行衰减（用未来 now，避免改动其他数据的 updatedAt）
    const r1 = await decayMemories(repo, prisma, { now: new Date(Date.now() + 10 * DAY_MS) });
    expect(r1.decayed).toBeGreaterThanOrEqual(1);
    const after10 = await prisma.memory.findUnique({ where: { id: item.id } });
    expect(after10).not.toBeNull();
    expect(after10!.strength).toBeCloseTo(Math.pow(MEMORY_DECAY_FACTOR_PER_DAY, 10), 5);
    // raw SQL 衰减不改 updatedAt，保证复利基准稳定
    expect(after10!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());

    // 模拟 200 天后：strength ≈ 0.95^200 ≪ 0.1 → 归档删除
    const r2 = await decayMemories(repo, prisma, { now: new Date(Date.now() + 200 * DAY_MS) });
    expect(r2.archived).toBeGreaterThanOrEqual(1);
    const gone = await prisma.memory.findUnique({ where: { id: item.id } });
    expect(gone).toBeNull();
    // 已从 createdIds 移除（forget 已清理文件与 FTS）
    const idx = createdIds.indexOf(item.id);
    if (idx >= 0) createdIds.splice(idx, 1);
  });

  it("forget：按 beforeStrength 清理并同步删除文件/FTS", async () => {
    const token = `${RUN}-forget-token`;
    const weak = await track(
      await repo.write({ content: `弱记忆 ${token}`, type: MEMORY_TYPES.NOTE, scope: "global", strength: MEMORY_ARCHIVE_THRESHOLD / 2, keywords: [token] }),
    );
    const strong = await track(
      await repo.write({ content: `强记忆 ${token}`, type: MEMORY_TYPES.NOTE, scope: "global", strength: 1.0, keywords: [token] }),
    );

    const deleted = await repo.forget({ beforeStrength: MEMORY_ARCHIVE_THRESHOLD });
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.memory.findUnique({ where: { id: weak.id } })).toBeNull();
    expect(await prisma.memory.findUnique({ where: { id: strong.id } })).not.toBeNull();
    const idx = createdIds.indexOf(weak.id);
    if (idx >= 0) createdIds.splice(idx, 1);
  });

  it("read：strength × recency 排序——高强旧记忆与新记忆按分数排序", async () => {
    const token = `${RUN}-rank-token`;
    const strong = await track(
      await repo.write({ content: `排序强记忆 ${token}`, type: MEMORY_TYPES.NOTE, scope: "global", strength: 1.0, keywords: [token] }),
    );
    const weak = await track(
      await repo.write({ content: `排序弱记忆 ${token}`, type: MEMORY_TYPES.NOTE, scope: "global", strength: 0.2, keywords: [token] }),
    );
    const items = await repo.read({ scopes: ["global"], keyword: token, limit: 10 });
    const ids = items.map((m) => m.id);
    expect(ids.indexOf(strong.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(weak.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(strong.id)).toBeLessThan(ids.indexOf(weak.id));
  });
});
