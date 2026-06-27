import { TRPCError } from "@trpc/server";
import { createAgentSchema, updateAgentSchema, listAgentsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

function formatAgent(agent: any) {
  return {
    ...agent,
    tools: agent.tools ? agent.tools.split(",").filter(Boolean) : [],
  };
}

export const agentRouter = router({
  create: publicProcedure.input(createAgentSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.agent.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Agent 名称已存在" });
    }

    const agent = await ctx.prisma.agent.create({
      data: {
        name: input.name,
        description: input.description,
        model: input.model,
        systemPrompt: input.systemPrompt,
        tools: input.tools.join(","),
      },
    });

    return formatAgent(agent);
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const agent = await ctx.prisma.agent.findUnique({ where: { id: input.id } });
    if (!agent) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agent 不存在" });
    }
    return formatAgent(agent);
  }),

  list: publicProcedure.input(listAgentsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.agent.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.agent.count({ where }),
    ]);

    return {
      items: items.map(formatAgent),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateAgentSchema).mutation(async ({ ctx, input }) => {
    const { id, tools, ...data } = input;

    const existing = await ctx.prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agent 不存在" });
    }

    const updateData: any = { ...data };
    if (tools !== undefined) {
      updateData.tools = tools.join(",");
    }

    const agent = await ctx.prisma.agent.update({
      where: { id },
      data: updateData,
    });

    return formatAgent(agent);
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.agent.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agent 不存在" });
    }

    await ctx.prisma.agent.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
