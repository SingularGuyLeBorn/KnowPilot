import { TRPCError } from "@trpc/server";
import { createMcpServerSchema, updateMcpServerSchema, listMcpServersSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

function formatMcpServer(server: any) {
  return {
    ...server,
    args: server.args ? (typeof server.args === 'string' ? JSON.parse(server.args) : server.args) : [],
    env: server.env ? (typeof server.env === 'string' ? JSON.parse(server.env) : server.env) : {},
  };
}

export const mcpRouter = router({
  create: publicProcedure.input(createMcpServerSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.mcpServer.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "MCP 服务名称已存在" });
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

    return formatMcpServer(server);
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
    const { id, args, env, ...data } = input;

    const existing = await ctx.prisma.mcpServer.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "MCP 服务不存在" });
    }

    const updateData: any = { ...data };
    if (args !== undefined) updateData.args = JSON.stringify(args);
    if (env !== undefined) updateData.env = JSON.stringify(env);

    const server = await ctx.prisma.mcpServer.update({
      where: { id },
      data: updateData,
    });

    return formatMcpServer(server);
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.mcpServer.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "MCP 服务不存在" });
    }

    await ctx.prisma.mcpServer.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
