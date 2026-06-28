import fs from "fs";
import path from "path";
import { TRPCError } from "@trpc/server";
import {
  createPostSchema,
  updatePostSchema,
  listPostsSchema,
  searchPostsSchema,
} from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

// 定位 content/posts 目录 (自适应执行路径)
let postsDir = path.resolve(process.cwd(), "content/posts");
if (!fs.existsSync(postsDir)) {
  postsDir = path.resolve(process.cwd(), "../../content/posts");
}

/** 辅助函数：将数据库文章写入本地 Markdown 文件 */
function writePostToMarkdown(
  slug: string,
  title: string,
  category: string | null,
  tags: string,
  published: boolean,
  excerpt: string | null,
  content: string
) {
  if (!fs.existsSync(postsDir)) {
    return; // 部署在只读环境或未找到目录时直接跳过
  }
  const filePath = path.join(postsDir, `${slug}.md`);
  const tagsList = tags ? tags.split(",").filter(Boolean) : [];
  const tagsYaml = tagsList.length > 0
    ? `\ntags:\n` + tagsList.map((t) => `  - "${t}"`).join("\n")
    : "";

  const fileContent = `---
title: "${title.replace(/"/g, '\\"')}"
category: ${category ? `"${category.replace(/"/g, '\\"')}"` : "null"}${tagsYaml}
published: ${published}
excerpt: ${excerpt ? `"${excerpt.replace(/"/g, '\\"')}"` : "null"}
---
${content}
`;
  fs.writeFileSync(filePath, fileContent, "utf-8");
}

/** 辅助函数：删除本地 Markdown 文件 */
function deleteMarkdownFile(slug: string) {
  if (!fs.existsSync(postsDir)) return;
  const filePath = path.join(postsDir, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`❌ 删除文件 ${filePath} 失败:`, err);
    }
  }
}

/** 将标题转为 URL 友好的 slug */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-") // 保留中文和英文数字
    .replace(/^-+|-+$/g, "")
    .substring(0, 80)
    .concat("-", Date.now().toString(36)); // 加时间戳防重复
}

/** 辅助函数：将文章数据库格式转换为 API 输出格式（tags 还原为数组） */
function formatPost(post: any) {
  return {
    ...post,
    tags: post.tags ? post.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
  };
}

export const postRouter = router({
  /** 分页列表 */
  list: publicProcedure.input(listPostsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, published, category, tag, keyword, orderBy, order } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (published !== undefined) where.published = published;
    if (category) where.category = category;
    if (tag) {
      where.tags = { contains: tag }; // SQLite 用 contains 查询逗号分隔串中的标签
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { content: { contains: keyword } },
      ];
    }

    const [rawItems, total] = await Promise.all([
      ctx.prisma.post.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [orderBy]: order },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          coverImage: true,
          published: true,
          category: true,
          tags: true,
          content: true,
          viewCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      ctx.prisma.post.count({ where }),
    ]);

    const items = rawItems.map(formatPost);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  /** 文档树：返回所有已发布文章的层级数据 */
  tree: publicProcedure.query(async ({ ctx }) => {
    const posts = await ctx.prisma.post.findMany({
      where: { published: true },
      select: { id: true, slug: true, title: true },
      orderBy: { slug: "asc" },
    });
    return posts;
  }),

  /** 按 slug 获取单篇 (文章详情页) */
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.prisma.post.findUnique({
        where: { slug: input.slug },
      });

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
      }

      // 增加浏览量
      await ctx.prisma.post.update({
        where: { id: post.id },
        data: { viewCount: { increment: 1 } },
      });

      return formatPost(post);
    }),

  /** 按 id 获取 (编辑器用) */
  getById: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.prisma.post.findUnique({
        where: { id: input.id },
      });

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
      }

      return formatPost(post);
    }),

  /** 创建文章 */
  create: publicProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const slug = input.slug || generateSlug(input.title);

      try {
        // 检查 slug 唯一性
        const existing = await ctx.prisma.post.findUnique({ where: { slug } });
        if (existing) {
          return failure({
            code: "POST_SLUG_CONFLICT",
            message: `创建文章失败：slug "${slug}" 已被文章 "${existing.title}" 占用。`,
            details: { slug, existingPostId: existing.id, existingTitle: existing.title },
            field: "slug",
            suggestion: "请指定一个不同的 slug，或先删除/修改冲突的文章。",
            retryable: false,
            suggestedAction: {
              procedure: "post.getBySlug",
              input: { slug },
              reason: "查看占用该 slug 的文章详情，确认是否需要修改它。",
            },
            operation: "create",
            entity: "post",
            durationMs: Date.now() - start,
          });
        }

        const post = await ctx.prisma.post.create({
          data: {
            title: input.title,
            slug,
            content: input.content,
            published: input.published ?? false,
            excerpt: input.excerpt,
            coverImage: input.coverImage,
            category: input.category,
            tags: input.tags?.join(",") || "",
          },
        });

        // 同步写回本地 Markdown 文件
        writePostToMarkdown(
          post.slug,
          post.title,
          post.category,
          post.tags,
          post.published,
          post.excerpt,
          post.content
        );

        return success({
          data: formatPost(post),
          state: { totalPosts: await ctx.prisma.post.count() },
          nextSteps: [
            {
              action: "前往编辑器继续完善文章",
              procedure: "post.getById",
              input: { id: post.id },
              reason: "刚创建的文章可以立即编辑。",
            },
          ],
          operation: "create",
          entity: "post",
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return failureFromError(error, "create", "post", "POST_CREATE_FAILED");
      }
    }),

  /** 更新文章 (包含自动保存草稿) */
  update: publicProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const { id, tags, ...data } = input;

      try {
        const existing = await ctx.prisma.post.findUnique({ where: { id } });
        if (!existing) {
          return failure({
            code: "POST_NOT_FOUND",
            message: `更新文章失败：id 为 "${id}" 的文章不存在。`,
            details: { id },
            field: "id",
            suggestion: "请调用 post.list 查询可用文章，或使用正确的 id。",
            retryable: false,
            suggestedAction: {
              procedure: "post.list",
              input: { pageSize: 20 },
              reason: "列出最近文章以获取正确的 id。",
            },
            operation: "update",
            entity: "post",
            durationMs: Date.now() - start,
          });
        }

        // 如果更新了 slug，检查唯一性
        if (data.slug && data.slug !== existing.slug) {
          const slugExists = await ctx.prisma.post.findUnique({
            where: { slug: data.slug },
          });
          if (slugExists) {
            return failure({
              code: "POST_SLUG_CONFLICT",
              message: `更新文章失败：slug "${data.slug}" 已被文章 "${slugExists.title}" 占用。`,
              details: { slug: data.slug, existingPostId: slugExists.id, existingTitle: slugExists.title },
              field: "slug",
              suggestion: "请指定一个不同的 slug，或先修改冲突文章。",
              retryable: false,
              suggestedAction: {
                procedure: "post.getBySlug",
                input: { slug: data.slug },
                reason: "查看占用该 slug 的文章详情。",
              },
              operation: "update",
              entity: "post",
              durationMs: Date.now() - start,
            });
          }
        }

        // 过滤并处理更新字段
        const updateData: any = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) updateData[key] = value;
        }
        if (tags !== undefined) {
          updateData.tags = tags.join(","); // 数组转逗号分隔字符串
        }

        const post = await ctx.prisma.post.update({
          where: { id },
          data: updateData,
        });

        // 如果 slug 发生变更，删除旧的本地 md 文件
        if (existing.slug !== post.slug) {
          deleteMarkdownFile(existing.slug);
        }

        // 同步覆盖写入本地 Markdown 文件
        writePostToMarkdown(
          post.slug,
          post.title,
          post.category,
          post.tags,
          post.published,
          post.excerpt,
          post.content
        );

        return success({
          data: formatPost(post),
          state: { totalPosts: await ctx.prisma.post.count() },
          operation: "update",
          entity: "post",
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return failureFromError(error, "update", "post", "POST_UPDATE_FAILED");
      }
    }),

  /** 删除文章 */
  delete: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();

      try {
        const existing = await ctx.prisma.post.findUnique({
          where: { id: input.id },
        });
        if (!existing) {
          return failure({
            code: "POST_NOT_FOUND",
            message: `删除文章失败：id 为 "${input.id}" 的文章不存在。`,
            details: { id: input.id },
            field: "id",
            suggestion: "请调用 post.list 确认要删除的文章 id。",
            retryable: false,
            suggestedAction: {
              procedure: "post.list",
              input: { pageSize: 20 },
              reason: "列出文章以获取正确的 id。",
            },
            operation: "delete",
            entity: "post",
            durationMs: Date.now() - start,
          });
        }

        await ctx.prisma.post.delete({ where: { id: input.id } });

        // 删除本地对应的 Markdown 文件
        deleteMarkdownFile(existing.slug);

        return success({
          data: { id: input.id, slug: existing.slug, title: existing.title },
          state: { totalPosts: await ctx.prisma.post.count() },
          nextSteps: [
            {
              action: "创建新文章",
              procedure: "post.create",
              reason: "已删除的文章无法恢复，可创建新文章替代。",
            },
          ],
          operation: "delete",
          entity: "post",
          durationMs: Date.now() - start,
        });
      } catch (error) {
        return failureFromError(error, "delete", "post", "POST_DELETE_FAILED");
      }
    }),

  /** 搜索 */
  search: publicProcedure
    .input(searchPostsSchema)
    .query(async ({ ctx, input }) => {
      const rawItems = await ctx.prisma.post.findMany({
        where: {
          OR: [
            { title: { contains: input.query } },
            { content: { contains: input.query } },
          ],
        },
        take: input.limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          published: true,
          tags: true,
          updatedAt: true,
        },
      });

      return rawItems.map(formatPost);
    }),

  /** 所有分类 */
  categories: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.post.findMany({
      where: { published: true, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return rows.map((r) => r.category).filter(Boolean) as string[];
  }),

  /** 所有标签 */
  tags: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.post.findMany({
      where: { published: true },
      select: { tags: true },
    });
    const tagSet = new Set<string>();
    for (const row of rows) {
      if (row.tags) {
        for (const tag of row.tags.split(",").map((t) => t.trim()).filter(Boolean)) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }),
});
