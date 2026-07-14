/**
 * MemoryRepository 测试（W5）
 *
 * 覆盖：
 * 1. scope 隔离：agent:A 的经验/记忆不出现在 agent:B 的 context（写时隔离）
 * 2. contentHash 去重：同 scope 同内容幂等刷新，不产生重复行
 * 3. strength 衰减：decayMemories 按日复利衰减，低分归档删除
 * 4. 三层 scope（W5-followup）：workspace 记忆同 Workspace 兄弟可见、外部不可见；
 *    resolveMemoryWriteScope 越权伪造抛错；accumulateExperience 双写 agent + workspace 层
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
  resolveMemoryWriteScope,
  type MemoryRepository,
} from "../infra/memoryRepository.js";
import { accumulateExperience } from "../infra/agentEvolution.js";
import { buildMemoryContext } from "../infra/promptBuilder.js";
import {
  MEMORY_ARCHIVE_THRESHOLD,
  MEMORY_DECAY_FACTOR_PER_DAY,
  MEMORY_TYPES,
  memoryAgentScope,
  memoryWorkspaceScope,
} from "@knowpilot/shared";

const RUN = `w5test-${Date.now()}`;
const DAY_MS = 86_400_000;

describe("MemoryRepository（W5）", () => {
  let services: ServiceContainer;
  let repo: MemoryRepository;
  const createdIds: string[] = [];
  const createdAgentIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(() => {
    services = getServiceContainer(prisma, getEventBus(), getAppConfig());
    repo = createMemoryRepository(services);
  });

  afterAll(async () => {
    // 走 MemoryService.delete 清理 DB + content/ 文件 + FTS 行
    for (const id of createdIds) {
      await services.memory.delete(id).catch(() => undefined);
    }
    // 先删 Agent（workspaceId 外键 SetNull），再删 Workspace
    for (const id of createdAgentIds) {
      await prisma.agent.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdWorkspaceIds) {
      await prisma.workspace.delete({ where: { id } }).catch(() => undefined);
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

  /* ─── 三层 scope（W5-followup） ─── */

  it("三层 scope：同 Workspace 兄弟 Agent 可见 workspace 记忆，外 Workspace / 无 Workspace Agent 不可见", async () => {
    const wsA = await prisma.workspace.create({ data: { name: `${RUN}-wsA`, path: `/tmp/${RUN}-wsA` } });
    const wsB = await prisma.workspace.create({ data: { name: `${RUN}-wsB`, path: `/tmp/${RUN}-wsB` } });
    createdWorkspaceIds.push(wsA.id, wsB.id);
    const agentA1 = await prisma.agent.create({ data: { name: `${RUN}-a1`, workspaceId: wsA.id, tier: "sub" } });
    const agentA2 = await prisma.agent.create({ data: { name: `${RUN}-a2`, workspaceId: wsA.id, tier: "sub" } });
    const agentB1 = await prisma.agent.create({ data: { name: `${RUN}-b1`, workspaceId: wsB.id, tier: "sub" } });
    const agentSolo = await prisma.agent.create({ data: { name: `${RUN}-solo`, tier: "sub" } });
    createdAgentIds.push(agentA1.id, agentA2.id, agentB1.id, agentSolo.id);

    const token = `${RUN}-ws-token`;
    await track(
      await repo.write({
        content: `Workspace A 的共享语义记忆 ${token}`,
        type: MEMORY_TYPES.SEMANTIC,
        scope: memoryWorkspaceScope(wsA.id),
        keywords: [token],
      }),
    );

    // 同 Workspace 兄弟（A2）与写入者（A1）都可见
    const ctxSibling = await buildMemoryContext(services, token, { agentId: agentA2.id });
    expect(ctxSibling.includes(token)).toBe(true);
    const ctxSelf = await buildMemoryContext(services, token, { agentId: agentA1.id });
    expect(ctxSelf.includes(token)).toBe(true);
    // 外 Workspace（B1）与无 Workspace 的 Agent 不可见
    const ctxOutside = await buildMemoryContext(services, token, { agentId: agentB1.id });
    expect(ctxOutside.includes(token)).toBe(false);
    const ctxSolo = await buildMemoryContext(services, token, { agentId: agentSolo.id });
    expect(ctxSolo.includes(token)).toBe(false);
  });

  it("resolveMemoryWriteScope：默认归属本 Agent，越权伪造其他 Agent/Workspace 直接抛错", () => {
    const ws = `${RUN}-guard-ws`;
    const sub = { agentId: `${RUN}-guard-sub`, workspaceId: ws, tier: "sub" };

    // 未指定 scope：有 Agent → agent 层；无 Agent（用户级聊天）→ 保持 global
    expect(resolveMemoryWriteScope(undefined, sub)).toBe(memoryAgentScope(sub.agentId));
    expect(resolveMemoryWriteScope(undefined, {})).toBe("global");
    // 简写解析到本 Agent / 本 Workspace
    expect(resolveMemoryWriteScope("agent", sub)).toBe(memoryAgentScope(sub.agentId));
    expect(resolveMemoryWriteScope("workspace", sub)).toBe(memoryWorkspaceScope(ws));
    // 显式全量 scope 与简写等价
    expect(resolveMemoryWriteScope(`workspace:${ws}`, sub)).toBe(memoryWorkspaceScope(ws));

    // 越权：伪造其他 Agent / 其他 Workspace
    expect(() => resolveMemoryWriteScope("agent:someone-else", sub)).toThrow(/越权/);
    expect(() => resolveMemoryWriteScope("workspace:other-ws", sub)).toThrow(/越权/);
    // 非 super 写 global 被拒；super 与无 Agent 的用户级聊天可写
    expect(() => resolveMemoryWriteScope("global", sub)).toThrow(/仅超级 Agent/);
    expect(resolveMemoryWriteScope("global", { agentId: "x", tier: "super" })).toBe("global");
    expect(resolveMemoryWriteScope("global", {})).toBe("global");
    // 无 Workspace 的 Agent 写 workspace 层被拒
    expect(() => resolveMemoryWriteScope("workspace", { agentId: "x", tier: "sub" })).toThrow(/不属于任何 Workspace/);
    // 非法值
    expect(() => resolveMemoryWriteScope("project:abc", sub)).toThrow(/无效的 memory scope/);
  });

  it("accumulateExperience：Agent 属于 Workspace 时经验双写 agent + workspace 两层，无 Workspace 只写 agent 层", async () => {
    const ws = await prisma.workspace.create({ data: { name: `${RUN}-exp-ws`, path: `/tmp/${RUN}-exp-ws` } });
    createdWorkspaceIds.push(ws.id);
    const agentInWs = await prisma.agent.create({ data: { name: `${RUN}-exp-inws`, workspaceId: ws.id, tier: "sub" } });
    const agentNoWs = await prisma.agent.create({ data: { name: `${RUN}-exp-nows`, tier: "sub" } });
    createdAgentIds.push(agentInWs.id, agentNoWs.id);

    const token = `${RUN}-dualwrite`;
    const runResult = {
      content: `任务完成 ${token}`,
      toolCalls: [{ id: "t1", name: "web_search", args: {}, result: "ok", kind: "tool" as const }],
      tokenUsage: null,
      roundsUsed: 1,
    };

    // 有 Workspace：agent 层私有副本 + workspace 层共享副本
    await accumulateExperience(prisma, services, agentInWs.id, `${RUN}-sess-1`, runResult, {
      message: `调研 ${token}`,
      trigger: "user",
      workspaceId: ws.id,
    }, 1234);
    const agentLayer = await repo.read({ types: [MEMORY_TYPES.EXPERIENCE], scopes: [memoryAgentScope(agentInWs.id)], keyword: token });
    expect(agentLayer.length).toBe(1);
    createdIds.push(...agentLayer.map((m) => m.id));
    const wsLayer = await repo.read({ types: [MEMORY_TYPES.EXPERIENCE], scopes: [memoryWorkspaceScope(ws.id)], keyword: token });
    expect(wsLayer.length).toBe(1);
    createdIds.push(...wsLayer.map((m) => m.id));
    expect(wsLayer[0]!.id).not.toBe(agentLayer[0]!.id);

    // 无 Workspace：只写 agent 层，不产生 workspace 记忆
    const token2 = `${RUN}-dualwrite-nows`;
    await accumulateExperience(prisma, services, agentNoWs.id, `${RUN}-sess-2`, {
      ...runResult,
      content: `任务完成 ${token2}`,
    }, { message: `调研 ${token2}`, trigger: "user", workspaceId: null }, 1234);
    const soloAgentLayer = await repo.read({ types: [MEMORY_TYPES.EXPERIENCE], scopes: [memoryAgentScope(agentNoWs.id)], keyword: token2 });
    expect(soloAgentLayer.length).toBe(1);
    createdIds.push(...soloAgentLayer.map((m) => m.id));
    const allRows = await prisma.memory.findMany({ where: { content: { contains: token2 } } });
    expect(allRows.every((r) => r.scope === memoryAgentScope(agentNoWs.id))).toBe(true);
  });
});
