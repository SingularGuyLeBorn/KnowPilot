import { TRPCError } from "@trpc/server";
import { createMcpServerSchema, updateMcpServerSchema, listMcpServersSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatMcpServer(server: any) {
  return {
    ...server,
    args: server.args ? (typeof server.args === 'string' ? JSON.parse(server.args) : server.args) : [],
    env: server.env ? (typeof server.env === 'string' ? JSON.parse(server.env) : server.env) : {},
  };
}

export const mcpRouter = router({
  create: publicProcedure.input(createMcpServerSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.mcpServer.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "MCP_SERVER_NAME_CONFLICT",
          message: `创建 MCP Server 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 MCP Server 占用。`,
          details: { name: input.name, existingMcpServerId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 MCP Server 名称，或先修改冲突服务的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "mcp.list",
            input: { pageSize: 20 },
            reason: "列出已有 MCP Server 以确认可用名称。",
          },
          operation: "create",
          entity: "mcpServer",
          durationMs: Date.now() - start,
        });
      }

      const server = await ctx.prisma.mcpServer.create({
        data: {
          name: input.name,
          command: input.command,
          args: JSON.stringify(input.args),
          env: JSON.stringify(input.env),
          enabled: input.enabled,
        },
      });

      return success({
        data: formatMcpServer(server),
        state: { totalMcpServers: await ctx.prisma.mcpServer.count() },
        nextSteps: [
          {
            action: "查看新创建的 MCP Server",
            procedure: "mcp.getById",
            input: { id: server.id },
            reason: "可立即查看 MCP Server 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "mcpServer",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "mcpServer", "MCP_SERVER_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const server = await ctx.prisma.mcpServer.findUnique({ where: { id: input.id } });
    if (!server) {
      throw new TRPCError({ code: "NOT_FOUND", message: "MCP 服务不存在" });
    }
    return formatMcpServer(server);
  }),

  list: publicProcedure.input(listMcpServersSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.name = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      ctx.prisma.mcpServer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.mcpServer.count({ where }),
    ]);

    return {
      items: items.map(formatMcpServer),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateMcpServerSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, args, env, name, ...data } = input;

    try {
      const existing = await ctx.prisma.mcpServer.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "MCP_SERVER_NOT_FOUND",
          message: `更新 MCP Server 失败：id 为 "${id}" 的 MCP Server 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 mcp.list 查询可用 MCP Server，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "mcp.list",
            input: { pageSize: 20 },
            reason: "列出最近 MCP Server 以获取正确的 id。",
          },
          operation: "update",
          entity: "mcpServer",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.mcpServer.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "MCP_SERVER_NAME_CONFLICT",
            message: `更新 MCP Server 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 MCP Server 占用。`,
            details: { name, existingMcpServerId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 MCP Server 名称，或先修改冲突服务的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "mcp.list",
              input: { pageSize: 20 },
              reason: "列出已有 MCP Server 以确认可用名称。",
            },
            operation: "update",
            entity: "mcpServer",
            durationMs: Date.now() - start,
          });
        }
      }

      const updateData: any = { ...data, name };
      if (args !== undefined) updateData.args = JSON.stringify(args);
      if (env !== undefined) updateData.env = JSON.stringify(env);

      const server = await ctx.prisma.mcpServer.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: formatMcpServer(server),
        state: { totalMcpServers: await ctx.prisma.mcpServer.count() },
        operation: "update",
        entity: "mcpServer",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "mcpServer", "MCP_SERVER_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.mcpServer.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "MCP_SERVER_NOT_FOUND",
          message: `删除 MCP Server 失败：id 为 "${input.id}" 的 MCP Server 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 mcp.list 确认要删除的 MCP Server id。",
          retryable: false,
          suggestedAction: {
            procedure: "mcp.list",
            input: { pageSize: 20 },
            reason: "列出 MCP Server 以获取正确的 id。",
          },
          operation: "delete",
          entity: "mcpServer",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.mcpServer.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalMcpServers: await ctx.prisma.mcpServer.count() },
        nextSteps: [
          {
            action: "创建新 MCP Server",
            procedure: "mcp.create",
            reason: "已删除的 MCP Server 无法恢复，可创建新服务替代。",
          },
        ],
        operation: "delete",
        entity: "mcpServer",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "mcpServer", "MCP_SERVER_DELETE_FAILED");
    }
  }),
});
