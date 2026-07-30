/**
 * inbox tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createInboxItemSchema,
  updateInboxItemSchema,
  listInboxItemsSchema,
  inboxCaptureUrlSchema,
  inboxCaptureUrlsSchema,
  inboxSyncZhihuSchema,
  inboxSyncXhsSchema,
  inboxSyncBilibiliSchema,
  inboxPlatformSyncStartSchema,
  inboxPlatformSyncProgressSchema,
  inboxScanScreenshotsSchema,
  inboxIngestWechatDropSchema,
  inboxDistillSchema,
  inboxIgnoreSchema,
  inboxEnrichSchema,
  inboxBulkDeleteSchema,
  inboxFacetsSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const inboxRouter = router({
  create: publicProcedure.meta({ description: "手动创建 Inbox 条目。", aiReadable: true }).input(createInboxItemSchema).mutation(({ ctx, input }) => ctx.services.inbox.create(input)),
  getById: publicProcedure.meta({ description: "获取 Inbox 条目详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.inbox.getById(input.id)),
  list: publicProcedure.meta({ description: "列出 Inbox 素材（截图/知乎/小红书/B站/微信）。", aiReadable: true }).input(listInboxItemsSchema).query(({ ctx, input }) => ctx.services.inbox.list(input)),
  update: publicProcedure.meta({ description: "更新 Inbox 条目。", aiReadable: true }).input(updateInboxItemSchema).mutation(({ ctx, input }) => ctx.services.inbox.update(input)),
  delete: publicProcedure.meta({ description: "删除 Inbox 条目。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.inbox.delete(input.id)),
  bulkDelete: publicProcedure.meta({ description: "批量删除 Inbox 条目（仅队列记录，不动已蒸馏文章）。", aiReadable: true }).input(inboxBulkDeleteSchema).mutation(({ ctx, input }) => ctx.services.inbox.bulkDelete(input.ids)),
  stats: publicProcedure.meta({ description: "Inbox 统计（待消化/已蒸馏/按来源）。", aiReadable: true }).query(({ ctx }) => ctx.services.inbox.stats()),
  facets: publicProcedure.meta({ description: "Inbox 分面：来源计数、知乎收藏夹、小红书点赞/收藏、B站收藏/稍后再看。", aiReadable: true }).input(inboxFacetsSchema).query(({ ctx, input }) => ctx.services.inbox.facets(input)),
  captureUrl: publicProcedure.meta({ description: "抓取单个 URL 写入 Inbox。", aiReadable: true }).input(inboxCaptureUrlSchema).mutation(({ ctx, input }) => ctx.services.inbox.captureUrl(input)),
  captureUrls: publicProcedure.meta({ description: "批量抓取 URL 写入 Inbox。", aiReadable: true }).input(inboxCaptureUrlsSchema).mutation(({ ctx, input }) => ctx.services.inbox.captureUrls(input)),
  syncZhihu: publicProcedure.meta({ description: "同步知乎收藏到 Inbox：优先 ZHIHU_ACCESS_SECRET 开放平台；否则 platform_login。不填 collectionUrl=全部收藏夹；mode=full|incremental。", aiReadable: true }).input(inboxSyncZhihuSchema).mutation(({ ctx, input }) => ctx.services.inbox.syncZhihu(input)),
  syncXhs: publicProcedure.meta({ description: "同步小红书点赞/收藏到 Inbox（需 platform_login xhs；mode=full|incremental；kinds 默认两者）。", aiReadable: true }).input(inboxSyncXhsSchema).mutation(({ ctx, input }) => ctx.services.inbox.syncXhs(input)),
  syncBilibili: publicProcedure.meta({ description: "同步 B 站收藏夹/稍后再看到 Inbox（需 platform_login bilibili；学 BiliNote 复用 SESSDATA；kinds=fav|toview）。", aiReadable: true }).input(inboxSyncBilibiliSchema).mutation(({ ctx, input }) => ctx.services.inbox.syncBilibili(input)),
  startPlatformSync: publicProcedure.meta({ description: "启动平台批量同步后台任务（立即返回 jobId，前端轮询 platformSyncProgress）。", aiReadable: true }).input(inboxPlatformSyncStartSchema).mutation(({ ctx, input }) => ctx.services.inbox.startPlatformSync(input)),
  cancelPlatformSync: publicProcedure.meta({ description: "停止进行中的平台同步（下一页/下一夹退出，已写入保留）。", aiReadable: true }).input(z.object({ jobId: z.string().min(1).max(64).optional() }).optional()).mutation(({ ctx, input }) => ctx.services.inbox.cancelPlatformSync(input?.jobId)),
  platformSyncProgress: publicProcedure.meta({ description: "查询平台批量同步进度（percent + 分步状态）。", aiReadable: true }).input(inboxPlatformSyncProgressSchema).query(({ ctx, input }) => ctx.services.inbox.getPlatformSyncProgress(input.jobId)),
  activePlatformSync: publicProcedure.meta({ description: "当前进行中的平台同步任务（无则 null）。", aiReadable: true }).query(({ ctx }) => ctx.services.inbox.getActivePlatformSync()),
  latestPlatformSync: publicProcedure.meta({ description: "最近一次平台同步任务（进行中优先，含已结束；切页恢复进度卡）。", aiReadable: true }).query(({ ctx }) => ctx.services.inbox.getLatestPlatformSync()),
  scanScreenshots: publicProcedure.meta({ description: "扫描截图目录 OCR 入库。", aiReadable: true }).input(inboxScanScreenshotsSchema).mutation(({ ctx, input }) => ctx.services.inbox.scanScreenshots(input)),
  ingestWechatDrop: publicProcedure.meta({ description: "读取 data/inbox/wechat/links.txt 入库。", aiReadable: true }).input(inboxIngestWechatDropSchema).mutation(({ ctx, input }) => ctx.services.inbox.ingestWechatDrop(input)),
  distill: publicProcedure.meta({ description: "将 Inbox 条目蒸馏为未发布 Post 草稿。", aiReadable: true }).input(inboxDistillSchema).mutation(({ ctx, input }) => ctx.services.inbox.distill(input)),
  enrich: publicProcedure.meta({ description: "分批补抓 Inbox 缺正文（防风控：跳过已有、条间慢间隔、撞墙停）。", aiReadable: true }).input(inboxEnrichSchema).mutation(({ ctx, input }) => ctx.services.inbox.enrichContent(input)),
  ignore: publicProcedure.meta({ description: "忽略 Inbox 条目。", aiReadable: true }).input(inboxIgnoreSchema).mutation(({ ctx, input }) => ctx.services.inbox.ignoreItems(input)),
});
