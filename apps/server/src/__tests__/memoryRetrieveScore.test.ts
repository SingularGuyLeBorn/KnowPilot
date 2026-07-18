/**
 * 记忆检索综合分 + retrieve-or-not 门控 + validTo 过滤
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { getEventBus } from "../infra/eventBus.js";
import { getAppConfig } from "../infra/config.js";
import {
  createMemoryRepository,
  scoreMemoryCandidate,
  consolidateMemories,
} from "../infra/memoryRepository.js";
import {
  __resetMemoryRetrieveGatesForTests,
  shouldSkipMemoryRetrieve,
  recordMemoryRetrieveOutcome,
  MEMORY_RETRIEVE_GATE,
} from "../infra/memoryRetrieveGate.js";
import { buildMemoryContext } from "../infra/promptBuilder.js";
import { MEMORY_TYPES, memoryAgentScope } from "@knowpilot/shared";

describe("scoreMemoryCandidate", () => {
  it("有更强 BM25（rank 更负）时分更高", () => {
    const now = Date.now();
    const updatedAt = new Date(now);
    const weak = scoreMemoryCandidate({
      strength: 1,
      updatedAt,
      nowMs: now,
      ftsRank: -1,
    });
    const strong = scoreMemoryCandidate({
      strength: 1,
      updatedAt,
      nowMs: now,
      ftsRank: -10,
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("strength 更高则分更高（无 FTS 时）", () => {
    const now = Date.now();
    const updatedAt = new Date(now);
    const a = scoreMemoryCandidate({ strength: 0.2, updatedAt, nowMs: now });
    const b = scoreMemoryCandidate({ strength: 1, updatedAt, nowMs: now });
    expect(b).toBeGreaterThan(a);
  });
});

describe("memoryRetrieveGate", () => {
  beforeEach(() => {
    __resetMemoryRetrieveGatesForTests();
  });

  it("连续 miss 达阈值后跳过若干轮", () => {
    const key = "gate-test";
    for (let i = 0; i < MEMORY_RETRIEVE_GATE.MISS_STREAK_TO_SKIP; i++) {
      expect(shouldSkipMemoryRetrieve(key)).toBe(false);
      recordMemoryRetrieveOutcome(key, false);
    }
    for (let i = 0; i < MEMORY_RETRIEVE_GATE.SKIP_AFTER_MISS; i++) {
      expect(shouldSkipMemoryRetrieve(key)).toBe(true);
    }
    // 配额用尽后恢复检索
    expect(shouldSkipMemoryRetrieve(key)).toBe(false);
  });

  it("命中后清零 streak", () => {
    const key = "gate-hit";
    recordMemoryRetrieveOutcome(key, false);
    recordMemoryRetrieveOutcome(key, false);
    recordMemoryRetrieveOutcome(key, true);
    for (let i = 0; i < MEMORY_RETRIEVE_GATE.MISS_STREAK_TO_SKIP; i++) {
      expect(shouldSkipMemoryRetrieve(key)).toBe(false);
      recordMemoryRetrieveOutcome(key, false);
    }
  });
});

describe("validTo + consolidate", () => {
  const services = getServiceContainer(prisma, getEventBus(), getAppConfig());
  const repo = createMemoryRepository(services);
  const ids: string[] = [];

  beforeEach(async () => {
    for (const id of ids.splice(0)) {
      await services.memory.delete(id).catch(() => undefined);
    }
  });

  it("过期记忆不进 read；consolidate 退役", async () => {
    const token = `expire-${Date.now()}`;
    const past = new Date(Date.now() - 60_000);
    const m = await repo.write({
      content: `已过期事实 ${token}`,
      type: MEMORY_TYPES.SEMANTIC,
      scope: memoryAgentScope(`agent-${token}`),
      keywords: [token],
      attribution: "agent",
      validTo: past,
    });
    ids.push(m.id);

    const found = await repo.read({
      keyword: token,
      scopes: [memoryAgentScope(`agent-${token}`)],
      limit: 10,
    });
    expect(found.every((x) => x.id !== m.id)).toBe(true);

    const { expired } = await consolidateMemories(prisma, async (id) => {
      const r = await services.memory.delete(id);
      return r.success;
    });
    expect(expired).toBeGreaterThanOrEqual(1);
  });
});

describe("buildMemoryContext 门控接线", () => {
  beforeEach(() => {
    __resetMemoryRetrieveGatesForTests();
  });

  it("门控跳过时返回空串且不抛错", async () => {
    const services = getServiceContainer(prisma, getEventBus(), getAppConfig());
    const aid = "nonexistent-agent-for-gate";
    for (let i = 0; i < MEMORY_RETRIEVE_GATE.MISS_STREAK_TO_SKIP; i++) {
      recordMemoryRetrieveOutcome(aid, false);
    }
    // 第一次 shouldSkip 在 buildMemoryContext 内消费
    const ctx = await buildMemoryContext(services, "随便问一句触发检索", { agentId: aid });
    expect(ctx).toBe("");
  });
});
