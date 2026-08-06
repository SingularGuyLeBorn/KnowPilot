/**
 * post tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createPostSchema, updatePostSchema, listPostsSchema, searchPostsSchema, relatedPostsSchema,
  createPostFromChatSchema, getPostBySlugSchema, postGardenSchema, postRecordViewSchema, explainSelectionSchema,
  deleteByIdSchema, deleteByIdWithApprovalSchema, postActivityCalendarSchema,
  postActivityDayDetailSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { withApprovalGuard } from "./withApprovalGuard.js";

export const postRouter = router({
  list: publicProcedure.meta({ description: "分页列出文章；可按花园 garden id /分类/标签/关键词过滤。", aiReadable: true }).input(listPostsSchema).query(({ ctx, input }) => ctx.services.post.list(input)),
  tree: publicProcedure.meta({ description: "获取已发布文章的 garden/slug/title 列表（可选花园过滤）。", aiReadable: true }).input(z.object({ garden: postGardenSchema.optional() }).default({})).query(({ ctx, input }) => ctx.services.post.tree(input.garden)),
  getBySlug: publicProcedure.meta({ description: "按花园 + slug 获取文章详情（不增加浏览量；阅读计数用 recordView）。", aiReadable: true }).input(getPostBySlugSchema).query(({ ctx, input }) => ctx.services.post.getBySlug(input.slug, input.garden)),
  recordView: publicProcedure.meta({ description: "记录一次文章阅读（viewCount+1）。", aiReadable: false }).input(postRecordViewSchema).mutation(({ ctx, input }) => ctx.services.post.recordView(input.id)),
  preview: publicProcedure.meta({ description: "文章内链 hover 预览（标题/摘要/正文前段），不增加浏览量。", aiReadable: true }).input(getPostBySlugSchema).query(({ ctx, input }) => ctx.services.post.preview(input.slug, input.garden)),
  getById: publicProcedure.meta({ description: "按 id 获取文章，用于编辑器加载。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.post.getById(input.id)),
  create: publicProcedure.meta({ description: "创建新文章到已存在的花园（garden），同步到 content/{garden}/{slug}.md。", aiReadable: true }).input(createPostSchema).mutation(({ ctx, input }) => ctx.services.post.create(input)),
  update: publicProcedure.meta({ description: "更新文章内容，自动同步到本地 Markdown 文件。", aiReadable: true }).input(updatePostSchema).mutation(({ ctx, input }) => ctx.services.post.update(input)),
  delete: publicProcedure.meta({ description: "删除文章到回收站。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "post.delete", { id: input.id }, input.approvalId, () => ctx.services.post.delete(input.id)),
  ),
  restore: publicProcedure.meta({ description: "从回收站恢复文章。", aiReadable: true }).input(deleteByIdSchema).mutation(({ ctx, input }) => ctx.services.post.restore(input.id)),
  // 软删铁律：永久删除仅人类 UI；aiReadable=false 禁止 Agent 经 invoke 反射触达
  permanentDelete: publicProcedure.meta({ description: "从回收站永久删除文章（仅人类 UI）。", aiReadable: false }).input(deleteByIdSchema).mutation(({ ctx, input }) => ctx.services.post.permanentDelete(input.id)),
  listDeleted: publicProcedure.meta({ description: "列出回收站中的文章。", aiReadable: true }).query(({ ctx }) => ctx.services.post.listDeleted()),
  search: publicProcedure.meta({ description: "搜索文章标题和内容（可选花园过滤）。", aiReadable: true }).input(searchPostsSchema).query(({ ctx, input }) => ctx.services.post.search(input.query, input.limit, input.garden)),
  related: publicProcedure
    .meta({
      description: "相关笔记：FTS + 标签交集 + 同花园/同分类加权，排除自身。",
      aiReadable: true,
    })
    .input(relatedPostsSchema)
    .query(({ ctx, input }) => ctx.services.post.related(input)),
  createFromChat: publicProcedure
    .meta({
      description: "把 Chat 消息落库为文章（create/update/append）；正文以服务端 message 为准。",
      aiReadable: false,
    })
    .input(createPostFromChatSchema)
    .mutation(({ ctx, input }) => ctx.services.post.createFromChat(input)),
  categories: publicProcedure.meta({ description: "获取所有已发布文章的分类列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.categories()),
  tags: publicProcedure.meta({ description: "获取所有已发布文章的标签列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.tags()),
  activityCalendar: publicProcedure
    .meta({
      description: "文章更新热力日历：按 updatedAt 按日聚合，供首页 GitHub 风格贡献图。",
      aiReadable: true,
    })
    .input(postActivityCalendarSchema)
    .query(({ ctx, input }) => ctx.services.post.activityCalendar(input)),
  activityDayDetail: publicProcedure
    .meta({
      description: "日历某日详情：新增/更新/删除文章 + 当日 LLM token 消耗。",
      aiReadable: true,
    })
    .input(postActivityDayDetailSchema)
    .query(({ ctx, input }) => ctx.services.post.activityDayDetail(input)),
  explainSelection: publicProcedure
    .meta({
      description: "阅读页划线解释：对用户划选原文做一次 LLM 解释（不建会话、不写回文章）。",
      aiReadable: false,
    })
    .input(explainSelectionSchema)
    .mutation(async ({ input }) => {
      const { explainPostSelection } = await import("../postExplain.js");
      return explainPostSelection(input);
    }),
});
