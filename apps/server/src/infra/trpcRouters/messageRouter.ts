/**
 * message tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createMessageSchema, updateMessageSchema, listMessagesSchema,
  listMessagesForChatSchema, switchMessageVersionSchema, setMessageLabelSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { switchAssistantMessageVersion } from "../agentStream.js";

export const messageRouter = router({
  create: publicProcedure.meta({ description: "发送聊天消息（用户或助手）。", aiReadable: true }).input(createMessageSchema).mutation(({ ctx, input }) => ctx.services.message.create(input)),
  getById: publicProcedure.meta({ description: "获取单条消息详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.message.getById(input.id)),
  list: publicProcedure.meta({ description: "分页获取某会话的消息列表。", aiReadable: true }).input(listMessagesSchema).query(({ ctx, input }) => ctx.services.message.list(input)),
  // P0-1：Chat 专用 cursor 无限查询（session 元数据与消息解耦）
  listForChat: publicProcedure
    .meta({ description: "Chat 消息 cursor 无限查询：无 cursor 返最近 limit 条，有 cursor 返更早 limit 条。", aiReadable: false })
    .input(listMessagesForChatSchema)
    .query(({ ctx, input }) => ctx.services.message.listForChat(input)),
  update: publicProcedure
    .meta({
      description: "更新消息内容（AI Studio 式手工编辑落库；assistant 会同步 versionMeta 激活版本）。",
      aiReadable: true,
    })
    .input(updateMessageSchema)
    .mutation(({ ctx, input }) => ctx.services.message.update(input)),
  delete: publicProcedure.meta({ description: "删除单条消息。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.message.delete(input.id)),
  switchVersion: publicProcedure
    .meta({ description: "切换 assistant 消息的多版本回答。", aiReadable: true })
    .input(switchMessageVersionSchema)
    .mutation(({ ctx, input }) => switchAssistantMessageVersion(ctx.services, input.messageId, input.versionIndex)),
  setLabel: publicProcedure
    .meta({ description: "为消息设置或清除书签标签。", aiReadable: false })
    .input(setMessageLabelSchema)
    .mutation(({ ctx, input }) => ctx.services.message.setLabel(input)),
});

