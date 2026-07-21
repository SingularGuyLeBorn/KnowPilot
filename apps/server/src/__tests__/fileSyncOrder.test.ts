/**
 * D1：Markdown↔DB 双写顺序不变量
 *
 * 不变量：文件先成为事实，DB 后投影；文件操作失败则 DB 不动。
 * 负向断言：旧实现（DB 先行）下本文件应红。
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);
const RUN = `d1-${Date.now().toString(36)}`;
const createdAgentIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of createdAgentIds.splice(0)) {
    try {
      const row = await prisma.agent.findUnique({ where: { id } });
      if (row) {
        const slug = `${row.name}-${id.slice(-6)}`;
        const fp = path.join(config.contentPaths.agents, `${slug}.md`);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        await prisma.agent.delete({ where: { id } }).catch(() => undefined);
      }
    } catch {
      /* cleanup best-effort */
    }
  }
});

describe("D1 FileSync 双写顺序", () => {
  it("create：writeFile 抛错时 DB 无行", async () => {
    const name = `${RUN}-create-fail`;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("模拟磁盘写失败");
    });

    const result = await services.agent.create({
      name,
      description: "d1",
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
    });

    expect(result.success).toBe(false);
    const row = await prisma.agent.findFirst({ where: { name } });
    expect(row).toBeNull();
    spy.mockRestore();
  });

  it("update 改名：写新文件失败时旧文件与 DB 行俱在", async () => {
    const name = `${RUN}-rename-old`;
    const created = await services.agent.create({
      name,
      description: "d1",
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
    });
    expect(created.success).toBe(true);
    const id = created.data!.id;
    createdAgentIds.push(id);

    const oldSlug = `${name}-${id.slice(-6)}`;
    const oldPath = path.join(config.contentPaths.agents, `${oldSlug}.md`);
    expect(fs.existsSync(oldPath)).toBe(true);
    const oldContent = fs.readFileSync(oldPath, "utf-8");

    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("模拟改名写新文件失败");
    });

    const updated = await services.agent.update({ id, name: `${RUN}-rename-new` });
    expect(updated.success).toBe(false);
    spy.mockRestore();

    const row = await prisma.agent.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.name).toBe(name);
    expect(fs.existsSync(oldPath)).toBe(true);
    expect(fs.readFileSync(oldPath, "utf-8")).toBe(oldContent);

    const newSlug = `${RUN}-rename-new-${id.slice(-6)}`;
    const newPath = path.join(config.contentPaths.agents, `${newSlug}.md`);
    expect(fs.existsSync(newPath)).toBe(false);
  });

  it("delete：文件删除失败时 DB 行仍在", async () => {
    const name = `${RUN}-del-fail`;
    const created = await services.agent.create({
      name,
      description: "d1",
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
    });
    expect(created.success).toBe(true);
    const id = created.data!.id;
    createdAgentIds.push(id);

    const spy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("模拟文件占用无法删除");
    });

    const deleted = await services.agent.delete(id);
    expect(deleted.success).toBe(false);
    spy.mockRestore();

    const row = await prisma.agent.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.name).toBe(name);
  });
});
