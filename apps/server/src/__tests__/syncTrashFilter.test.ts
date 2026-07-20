/**
 * D2：Windows 下 .trash 过滤必须生效
 *
 * 负向：旧实现用正斜杠模板 includes，Windows 反斜杠路径永不命中 → 回收站文章复活。
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { getContentDir } from "../scripts/sync/utils.js";
import { postSyncer } from "../scripts/sync/sync-posts.js";

const RUN = `d2-${Date.now().toString(36)}`;
const trashSlug = `.trash/${RUN}-trashed`;
const createdSlugs: string[] = [];

afterEach(async () => {
  for (const slug of createdSlugs.splice(0)) {
    await prisma.post.deleteMany({ where: { slug } }).catch(() => undefined);
  }
  const contentDir = getContentDir("posts");
  const trashFile = path.join(contentDir, ".trash", `${RUN}-trashed.md`);
  if (fs.existsSync(trashFile)) fs.unlinkSync(trashFile);
});

describe("D2 sync-posts .trash 过滤", () => {
  it("db:sync scan 不得把 .trash 下文章 upsert 为公开 Post", async () => {
    const contentDir = getContentDir("posts");
    const trashDir = path.join(contentDir, ".trash");
    fs.mkdirSync(trashDir, { recursive: true });
    const trashFile = path.join(trashDir, `${RUN}-trashed.md`);
    fs.writeFileSync(
      trashFile,
      [
        "---",
        `title: "${RUN} 回收站文章"`,
        "published: true",
        "---",
        "不应被 sync 复活。",
      ].join("\n"),
      "utf-8",
    );

    const records = await postSyncer.scan(prisma, contentDir);
    const hit = records.find((r) => r.slug === trashSlug || r.slug.includes(".trash"));
    expect(hit).toBeUndefined();

    // 全量 upsert 路径也不应创建该 slug
    for (const r of records) {
      if (r.slug.includes(".trash")) {
        await postSyncer.upsert(prisma, r);
        createdSlugs.push(r.slug);
      }
    }
    const row = await prisma.post.findFirst({ where: { slug: { contains: `${RUN}-trashed` } } });
    expect(row).toBeNull();
  });
});
