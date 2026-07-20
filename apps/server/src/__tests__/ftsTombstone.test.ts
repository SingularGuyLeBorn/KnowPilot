/**
 * D5：FTS 墓碑过滤 + watch upsert 可搜
 *
 * 负向：旧 rebuildFtsIndex 不过滤 deletedAt/status=deleted → 回收站/已删实体重回搜索。
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { rebuildFtsIndex, searchFts, deleteFtsRow } from "../infra/ftsIndex.js";
import { postSyncer } from "../scripts/sync/sync-posts.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);
const RUN = `d5-${Date.now().toString(36)}`;
const cleanupPostIds: string[] = [];
const cleanupAgentIds: string[] = [];

afterEach(async () => {
  for (const id of cleanupPostIds.splice(0)) {
    await deleteFtsRow(prisma, "post", id).catch(() => undefined);
    const row = await prisma.post.findUnique({ where: { id } }).catch(() => null);
    if (row) {
      const fp = path.join(config.contentPaths.posts, `${row.slug}.md`);
      const trash = path.join(config.contentPaths.posts, ".trash", `${row.slug}.md`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      if (fs.existsSync(trash)) fs.unlinkSync(trash);
      await prisma.post.delete({ where: { id } }).catch(() => undefined);
    }
  }
  for (const id of cleanupAgentIds.splice(0)) {
    await deleteFtsRow(prisma, "agent", id).catch(() => undefined);
    const row = await prisma.agent.findUnique({ where: { id } }).catch(() => null);
    if (row) {
      const slug = row.sourceSlug || `${row.name}-${id.slice(-6)}`;
      const fp = path.join(config.contentPaths.agents, `${slug}.md`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await prisma.agent.delete({ where: { id } }).catch(() => undefined);
    }
  }
});

describe("D5 FTS 墓碑与 syncer 挂钩", () => {
  it("rebuildFtsIndex 不含回收站 post / deleted agent", async () => {
    const token = `${RUN}tombstone`;
    const post = await services.post.create({
      title: `${token} 回收站文`,
      content: `body ${token}`,
      slug: `${RUN}-trashed-post`,
      published: true,
    });
    expect(post.success).toBe(true);
    cleanupPostIds.push(post.data!.id);
    await services.post.delete(post.data!.id);

    const agent = await services.agent.create({
      name: `${RUN}-del-agent`,
      description: token,
      model: "deepseek-chat",
      systemPrompt: `sys ${token}`,
      tools: [],
    });
    expect(agent.success).toBe(true);
    cleanupAgentIds.push(agent.data!.id);
    await prisma.agent.update({
      where: { id: agent.data!.id },
      data: { status: "deleted", deletedAt: new Date() },
    });

    await rebuildFtsIndex(prisma);
    const hits = await searchFts(prisma, token, 50);
    expect(hits.some((h) => h.entity === "post" && h.entityId === post.data!.id)).toBe(false);
    expect(hits.some((h) => h.entity === "agent" && h.entityId === agent.data!.id)).toBe(false);
  });

  it("syncer upsert 后 FTS 可搜到", async () => {
    const token = `${RUN}watchfts`;
    const slug = `${RUN}-watch-post`;
    const contentDir = config.contentPaths.posts;
    const filePath = path.join(contentDir, `${slug}.md`);
    fs.writeFileSync(
      filePath,
      `---\ntitle: "${token} 可见"\npublished: true\n---\ncontent ${token}\n`,
      "utf-8",
    );

    const record = await postSyncer.scanFile!(filePath, contentDir);
    expect(record).not.toBeNull();
    await postSyncer.upsert(prisma, record!);

    const row = await prisma.post.findUnique({ where: { slug } });
    expect(row).not.toBeNull();
    cleanupPostIds.push(row!.id);

    const hits = await searchFts(prisma, token, 50);
    expect(hits.some((h) => h.entity === "post" && h.entityId === row!.id)).toBe(true);
  });
});
