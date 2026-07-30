/**
 * mcp tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { withApprovalGuard } from "./withApprovalGuard.js";
import { createMcpServerSchema, updateMcpServerSchema, listMcpServersSchema, deleteByIdWithApprovalSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const mcpRouter = router({
  create: publicProcedure.meta({ description: "注册 MCP 服务器配置。name 必须唯一。", aiReadable: true }).input(createMcpServerSchema).mutation(({ ctx, input }) => ctx.services.mcp.create(input)),
  getById: publicProcedure.meta({ description: "获取 MCP 服务器详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.mcp.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有 MCP 服务器配置。", aiReadable: true }).input(listMcpServersSchema).query(({ ctx, input }) => ctx.services.mcp.list(input)),
  update: publicProcedure.meta({ description: "更新 MCP 服务器配置。", aiReadable: true }).input(updateMcpServerSchema).mutation(({ ctx, input }) => ctx.services.mcp.update(input)),
  delete: publicProcedure.meta({ description: "删除 MCP 服务器配置及本地 JSON 文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "mcp.delete", { id: input.id }, input.approvalId, () => ctx.services.mcp.delete(input.id)),
  ),
});
