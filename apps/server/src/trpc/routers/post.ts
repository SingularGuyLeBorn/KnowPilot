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
    tags: post.tags ? post.tags.split(",").filter(Boolean) : [],
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
      const slug = input.slug || generateSlug(input.title);

      // 检查 slug 唯一性
      const existing = await ctx.prisma.post.findUnique({ where: { slug } });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `slug "${slug}" 已存在`,
        });
      }

      const post = await ctx.prisma.post.create({
        data: {
          title: input.title,
          slug,
          content: input.content,
          published: false,
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

      return formatPost(post);
    }),

  /** 更新文章 (包含自动保存草稿) */
  update: publicProcedure
    .input(updatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, tags, ...data } = input;

      const existing = await ctx.prisma.post.findUnique({ where: { id } });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
      }

      // 如果更新了 slug，检查唯一性
      if (data.slug && data.slug !== existing.slug) {
        const slugExists = await ctx.prisma.post.findUnique({
          where: { slug: data.slug },
        });
        if (slugExists) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `slug "${data.slug}" 已存在`,
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

      return formatPost(post);
    }),

  /** 删除文章 */
  delete: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.post.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
      }

      await ctx.prisma.post.delete({ where: { id: input.id } });

      // 删除本地对应的 Markdown 文件
      deleteMarkdownFile(existing.slug);

      return { success: true };
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
});
