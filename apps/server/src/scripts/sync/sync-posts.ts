/**
 * Post / Articles 同步器
 */

import { PrismaClient } from "@prisma/client";
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
    const filePaths = getFilesRecursive(contentDir, [".md"]).filter((p) => !p.includes(`${contentDir}/.trash/`));
    const records: SyncRecord<PostData>[] = [];

    for (const filePath of filePaths) {
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

        records.push({
          slug,
          mtime,
          data: { slug, title, content, excerpt, published, category, tags },
        });
      } catch (e: any) {
        console.error(`  ❌ [Post 解析失败] ${filePath}:`, e.message);
      }
    }

    return records;
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
        deletedAt: null,
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
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
    const allInDb = await prisma.post.findMany({ where: { deletedAt: null }, select: { slug: true, title: true } });
    let deleted = 0;

    for (const dbPost of allInDb) {
      if (!activeSlugs.includes(dbPost.slug)) {
        await prisma.post.delete({ where: { slug: dbPost.slug } });
        console.log(`  🗑️ [Post 已清理] "${dbPost.title}" (本地文件已被删除)`);
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
