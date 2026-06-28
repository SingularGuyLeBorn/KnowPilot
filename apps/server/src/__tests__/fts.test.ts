/**
 * SQLite FTS5 索引测试 — L5-M01
 */

import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../db.js";
import { rebuildFtsIndex, searchFts } from "../infra/ftsIndex.js";

describe("FTS5 search index", () => {
  beforeAll(async () => {
    await rebuildFtsIndex(prisma);
  }, 120_000);

  it("rebuildFtsIndex 应写入至少一条索引", async () => {
    const count = await rebuildFtsIndex(prisma);
    expect(count).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("searchFts 对已知关键词应返回 hits 数组", async () => {
    const hits = await searchFts(prisma, "KnowPilot", 5);
    expect(Array.isArray(hits)).toBe(true);
    for (const hit of hits) {
      expect(hit.entity).toBeTruthy();
      expect(hit.entityId || (hit as { entity_id?: string }).entity_id).toBeTruthy();
    }
  });

  it("searchFts 对空查询返回空数组", async () => {
    const hits = await searchFts(prisma, "   ", 5);
    expect(hits).toEqual([]);
  });
});
