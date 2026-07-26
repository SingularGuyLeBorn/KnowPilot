/**
 * 动态知识库花园：CRUD、空库删除、未知 garden 拒写、_garden.md 不成 Post
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { getAppConfig, resolveGardenMetaPath } from "../infra/config.js";
import { prisma } from "../db.js";

describe("动态 Garden + 首页", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  const runId = `g${Date.now().toString(36)}`;
  const gardenId = `dyn-${runId}`;

  beforeAll(async () => {
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { garden: gardenId } }).catch(() => undefined);
    await prisma.garden.deleteMany({ where: { id: gardenId } }).catch(() => undefined);
    const dir = path.join(getAppConfig().contentDir, gardenId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    const trash = path.join(getAppConfig().contentDir, ".trash", "gardens");
    if (fs.existsSync(trash)) {
      for (const name of fs.readdirSync(trash)) {
        if (name.startsWith(gardenId)) {
          fs.rmSync(path.join(trash, name), { recursive: true, force: true });
        }
      }
    }
  });

  it("种子库存在；可新建第 N 座库并读首页", async () => {
    const list = await caller.garden.list({ page: 1, pageSize: 50 });
    expect(list.items.some((g) => g.id === "posts")).toBe(true);

    const created = await caller.garden.create({
      id: gardenId,
      title: "动态测试库",
      description: "unit",
      homeContent: "# Hello Garden\n\n首页正文。\n",
    });
    expect(created.success).toBe(true);
    expect(created.data?.id).toBe(gardenId);

    const metaPath = resolveGardenMetaPath(getAppConfig(), gardenId);
    expect(fs.existsSync(metaPath)).toBe(true);

    const got = await caller.garden.getById({ id: gardenId });
    expect(got.title).toBe("动态测试库");
    expect(got.homeContent).toContain("首页正文");
  });

  it("_garden.md 不会被 sync 成 Post", async () => {
    const posts = await prisma.post.findMany({
      where: { garden: gardenId, slug: { contains: "_garden" } },
    });
    expect(posts.length).toBe(0);
  });

  it("未知花园拒绝 post.create；已有花园可写", async () => {
    const bad = await caller.post.create({
      title: "bad",
      garden: "no-such-garden-xyz",
      content: "x",
      published: false,
    });
    expect(bad.success).toBe(false);

    const ok = await caller.post.create({
      title: `文章 ${runId}`,
      garden: gardenId,
      slug: `note-${runId}`,
      content: "body",
      published: true,
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.garden).toBe(gardenId);
  });

  it("非空库拒绝删除；删文后可删库", async () => {
    const blocked = await caller.garden.delete({ id: gardenId });
    expect(blocked.success).toBe(false);

    const posts = await prisma.post.findMany({
      where: { garden: gardenId, deletedAt: null },
    });
    for (const p of posts) {
      await caller.post.delete({ id: p.id });
    }

    const deleted = await caller.garden.delete({ id: gardenId });
    expect(deleted.success).toBe(true);

    await expect(caller.garden.getById({ id: gardenId })).rejects.toThrow();
  });

  it("种子库不可删", async () => {
    const res = await caller.garden.delete({ id: "posts" });
    expect(res.success).toBe(false);
  });
});
