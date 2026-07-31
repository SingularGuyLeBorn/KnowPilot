/**
 * Post / 知识库花园同步器
 *
 * 每棵花园（posts / knowledge / resources）注册一个 Syncer，
 * contentDirName = garden 名，物理根 content/{garden}/。
 * DB 唯一键：(garden, slug)；slug 仍是该根下相对路径。
 */

import { PrismaClient } from "@prisma/client";
import { upsertFtsRow, deleteFtsRow } from "../../infra/ftsIndex.js";
import { getAppConfig } from "../../infra/config.js";
import { buildPostFtsBody } from "../../services.js";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, getFileMtime } from "./utils.js";
import { discoverGardenIds } from "./discover-gardens.js";

interface PostData {
  garden: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  published: boolean;
  category: string | null;
  tags: string;
}

export function createPostGardenSyncer(garden: string): Syncer<PostData> {
  const entityName = `Post:${garden}`;

  return {
    entityName,
    contentDirName: garden,
    extensions: [".md"],

    async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<PostData>[]> {
      const filePaths = getFilesRecursive(contentDir, [".md"]);
      const records: SyncRecord<PostData>[] = [];
      for (const filePath of filePaths) {
        const r = await this.scanFile!(filePath, contentDir);
        if (r) records.push(r);
      }
      return records;
    },

    async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<PostData> | null> {
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const { data, content } = parseMarkdownFile(filePath);

        const title = typeof data.title === "string" ? data.title : slug;
        const category = typeof data.category === "string" ? data.category : null;
        const excerpt = typeof data.excerpt === "string" ? data.excerpt : null;
        const published = typeof data.published === "boolean" ? data.published : true;

        let tags = "";
        if (Array.isArray(data.tags)) {
          tags = data.tags.filter((t: unknown): t is string => typeof t === "string").map((t) => t.trim()).join(",");
        } else if (typeof data.tags === "string") {
          tags = data.tags;
        }

        return {
          slug,
          mtime,
          data: { garden, slug, title, content, excerpt, published, category, tags },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ [Post:${garden} 解析失败] ${filePath}:`, msg);
        return null;
      }
    },

    async upsert(prisma: PrismaClient, record: SyncRecord<PostData>): Promise<void> {
      const { slug, mtime, data } = record;

      await prisma.post.upsert({
        where: { garden_slug: { garden, slug } },
        update: {
          title: data.title,
          content: data.content,
          excerpt: data.excerpt,
          published: data.published,
          category: data.category,
          tags: data.tags,
          sourceMtime: mtime,
          deletedAt: null,
        },
        create: {
          garden,
          slug,
          title: data.title,
          content: data.content,
          excerpt: data.excerpt,
          published: data.published,
          category: data.category,
          tags: data.tags,
          sourceMtime: mtime,
          deletedAt: null,
        },
      });

      const row = await prisma.post.findUnique({
        where: { garden_slug: { garden, slug } },
        select: { id: true, title: true, content: true, slug: true, garden: true, category: true, tags: true, deletedAt: true },
      });
      if (row && !row.deletedAt) {
        try {
          // 与 postService 增量路径统一：body 含 category/tags，标签/分类立即可搜
          await upsertFtsRow(prisma, "post", row.id, row.title, buildPostFtsBody(row));
        } catch (e) {
          console.warn(`  ⚠️ [Post FTS] upsert 失败 garden=${garden} slug=${slug}:`, e instanceof Error ? e.message : e);
        }
      } else if (row?.deletedAt) {
        try {
          await deleteFtsRow(prisma, "post", row.id);
        } catch {
          /* best-effort */
        }
      }
    },

    async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
      const rows = await prisma.post.findMany({
        where: { garden, slug, deletedAt: null },
        select: { id: true },
      });
      const r = await prisma.post.updateMany({
        where: { garden, slug, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      for (const row of rows) {
        try {
          await deleteFtsRow(prisma, "post", row.id);
        } catch (e) {
          console.warn(`  ⚠️ [Post FTS] delete 失败 id=${row.id}:`, e instanceof Error ? e.message : e);
        }
      }
      return r.count;
    },

    async cleanup(prisma: PrismaClient, activeSlugs: string[], contentDir?: string): Promise<number> {
      if (activeSlugs.length === 0) {
        console.warn(`  ⚠️ [Post:${garden}] activeSlugs 为空，跳过 cleanup 以防误删。`);
        return 0;
      }

      const diskSlugs = new Set<string>(activeSlugs);
      if (contentDir) {
        try {
          const allFiles = getFilesRecursive(contentDir, [".md"]);
          for (const filePath of allFiles) {
            try {
              diskSlugs.add(filePathToSlug(contentDir, filePath));
            } catch {
              /* 文件仍在磁盘 */
            }
          }
        } catch {
          console.warn(`  ⚠️ [Post:${garden}] contentDir 读取失败，跳过 cleanup。`);
          return 0;
        }
      }

      const allInDb = await prisma.post.findMany({
        where: { garden, deletedAt: null },
        select: { id: true, slug: true, title: true },
      });
      let deleted = 0;

      for (const dbPost of allInDb) {
        if (!diskSlugs.has(dbPost.slug)) {
          await prisma.post.update({
            where: { id: dbPost.id },
            data: { deletedAt: new Date() },
          });
          try {
            await deleteFtsRow(prisma, "post", dbPost.id);
          } catch {
            /* best-effort */
          }
          console.log(`  🗑️ [Post:${garden} 已软删] "${dbPost.title}" (本地文件已不存在)`);
          deleted++;
        }
      }

      return deleted;
    },

    async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
      const rows = await prisma.post.findMany({
        where: { garden, deletedAt: null },
        select: { slug: true, sourceMtime: true },
      });
      const map = new Map<string, Date>();
      for (const row of rows) {
        if (row.sourceMtime) map.set(row.slug, row.sourceMtime);
      }
      return map;
    },
  };
}

/** 按当前 content/ 发现结果动态构建 Post syncer 列表 */
export function buildPostGardenSyncers(contentRoot?: string): Syncer<PostData>[] {
  const root = contentRoot ?? getAppConfig().contentDir;
  return discoverGardenIds(root).map(createPostGardenSyncer);
}

/** 博客花园（posts）syncer —— 单测专用 */
export const postSyncer = createPostGardenSyncer("posts");
