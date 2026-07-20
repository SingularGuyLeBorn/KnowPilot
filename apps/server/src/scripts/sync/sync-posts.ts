/**
 * Post / Articles 同步器
 */

import { PrismaClient } from "@prisma/client";
import { upsertFtsRow, deleteFtsRow } from "../../infra/ftsIndex.js";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, getFileMtime } from "./utils.js";

interface PostData {
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  published: boolean;
  category: string | null;
  tags: string;
}

export const postSyncer: Syncer<PostData> = {
  entityName: "Post",
  contentDirName: "posts",
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

  // A13：单文件解析，scan 委托本方法，watch 模式直接调用避免全目录扫描
  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<PostData> | null> {
    try {
      const slug = filePathToSlug(contentDir, filePath);
      const mtime = getFileMtime(filePath);
      const { data, content, fileName } = parseMarkdownFile(filePath);

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
        data: { slug, title, content, excerpt, published, category, tags },
      };
    } catch (e: any) {
      console.error(`  ❌ [Post 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<PostData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.post.upsert({
      where: { slug },
      update: {
        title: data.title,
        content: data.content,
        excerpt: data.excerpt,
        published: data.published,
        category: data.category,
        tags: data.tags,
        sourceMtime: mtime,
        // 安全：sync 不再覆盖 deletedAt —— 已软删的文章不会被 sync 复活，
        // 恢复需走显式的回收站恢复 API（PostService.restore）。
      },
      create: {
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

    // D5：watch/全量 upsert 与 DB 同处维护 FTS（墓碑不入索引）
    const row = await prisma.post.findUnique({
      where: { slug },
      select: { id: true, title: true, content: true, slug: true, deletedAt: true },
    });
    if (row && !row.deletedAt) {
      try {
        await upsertFtsRow(prisma, "post", row.id, row.title, `${row.slug}\n${row.content ?? ""}`);
      } catch (e) {
        console.warn(`  ⚠️ [Post FTS] upsert 失败 slug=${slug}:`, e instanceof Error ? e.message : e);
      }
    } else if (row?.deletedAt) {
      try {
        await deleteFtsRow(prisma, "post", row.id);
      } catch {
        /* best-effort */
      }
    }
  },

  // #7：unlink 增量软删（与 cleanup 语义一致，进回收站可恢复）
  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const rows = await prisma.post.findMany({ where: { slug, deletedAt: null }, select: { id: true } });
    const r = await prisma.post.updateMany({ where: { slug, deletedAt: null }, data: { deletedAt: new Date() } });
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
    // 防御：activeSlugs 为空（目录为空或配置错误）时绝不清理，避免一次性清库
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [Post] activeSlugs 为空，跳过 cleanup 以防误删（请检查 content/posts 目录）。`);
      return 0;
    }

    // 磁盘存在性检查：重新扫描目录（含解析失败的文件），仅清理「文件确实已不存在」的记录。
    // 这样解析失败的文件（仍在磁盘）不会被误删。
    const diskSlugs = new Set<string>(activeSlugs);
    if (contentDir) {
      try {
        const allFiles = getFilesRecursive(contentDir, [".md"]);
        for (const filePath of allFiles) {
          try {
            diskSlugs.add(filePathToSlug(contentDir, filePath));
          } catch {
            // 即使 slug 转换失败，文件仍存在，不应被清理
          }
        }
      } catch {
        // 目录读取失败时不清理，保守不动 DB
        console.warn(`  ⚠️ [Post] contentDir 读取失败，跳过 cleanup。`);
        return 0;
      }
    }

    const allInDb = await prisma.post.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, title: true } });
    let deleted = 0;

    for (const dbPost of allInDb) {
      if (!diskSlugs.has(dbPost.slug)) {
        // 改为软删：与 PostService.delete 语义一致，进回收站而非硬删，可恢复
        await prisma.post.update({ where: { slug: dbPost.slug }, data: { deletedAt: new Date() } });
        try {
          await deleteFtsRow(prisma, "post", dbPost.id);
        } catch {
          /* best-effort */
        }
        console.log(`  🗑️ [Post 已软删] "${dbPost.title}" (本地文件已不存在，移入回收站)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.post.findMany({
      select: { slug: true, sourceMtime: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.sourceMtime) {
        map.set(row.slug, row.sourceMtime);
      }
    }
    return map;
  },
};
