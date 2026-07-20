/**
 * D4：watch unlink 刚 update 过的旧 slug 不得硬删实体
 *
 * 负向：无 guardedWatchDeleteBySlug 时直接 deleteBySlug 会删掉刚改名的行。
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { guardedWatchDeleteBySlug } from "../scripts/sync/watchDeleteGuard.js";
import { agentSyncer } from "../scripts/sync/sync-agents.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);
const RUN = `d4-${Date.now().toString(36)}`;
const createdIds: string[] = [];

afterEach(async () => {
  for (const id of createdIds.splice(0)) {
    const row = await prisma.agent.findUnique({ where: { id } }).catch(() => null);
    if (row) {
      const slug = row.sourceSlug || `${row.name}-${id.slice(-6)}`;
      const fp = path.join(config.contentPaths.agents, `${slug}.md`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await prisma.agent.delete({ where: { id } }).catch(() => undefined);
    }
  }
});

describe("D4 watch deleteBySlug 保护", () => {
  it("刚 update 的行的旧 slug 收到 unlink → 行未被删", async () => {
    const name = `${RUN}-agent`;
    const created = await services.agent.create({
      name,
      description: "d4",
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
    });
    expect(created.success).toBe(true);
    const id = created.data!.id;
    createdIds.push(id);

    const oldSlug = `${name}-${id.slice(-6)}`;
    // 模拟改名窗口：DB 行刚更新但 sourceSlug 仍指向旧文件
    await prisma.agent.update({
      where: { id },
      data: { name: `${RUN}-renamed`, sourceSlug: oldSlug, updatedAt: new Date() },
    });

    const result = await guardedWatchDeleteBySlug(prisma, agentSyncer, oldSlug);
    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(0);

    const row = await prisma.agent.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.sourceSlug).toBe(oldSlug);
  });
});
