import { TRPCError } from "@trpc/server";
import { createAgentSchema, updateAgentSchema, listAgentsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatAgent(agent: any) {
  return {
    ...agent,
    tools: agent.tools ? agent.tools.split(",").filter(Boolean) : [],
  };
}

export const agentRouter = router({
  create: publicProcedure.input(createAgentSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.agent.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "AGENT_NAME_CONFLICT",
          message: `创建 Agent 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 Agent 占用。`,
          details: { name: input.name, existingAgentId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 Agent 名称，或先修改冲突 Agent 的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "agent.list",
            input: { pageSize: 20 },
            reason: "列出已有 Agent 以确认可用名称。",
          },
          operation: "create",
          entity: "agent",
          durationMs: Date.now() - start,
        });
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

      return success({
        data: formatAgent(agent),
        state: { totalAgents: await ctx.prisma.agent.count() },
        nextSteps: [
          {
            action: "查看新创建的 Agent",
            procedure: "agent.getById",
            input: { id: agent.id },
            reason: "可立即查看 Agent 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "agent",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "agent", "AGENT_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, tools, name, ...data } = input;

    try {
      const existing = await ctx.prisma.agent.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "AGENT_NOT_FOUND",
          message: `更新 Agent 失败：id 为 "${id}" 的 Agent 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 agent.list 查询可用 Agent，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "agent.list",
            input: { pageSize: 20 },
            reason: "列出最近 Agent 以获取正确的 id。",
          },
          operation: "update",
          entity: "agent",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.agent.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "AGENT_NAME_CONFLICT",
            message: `更新 Agent 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 Agent 占用。`,
            details: { name, existingAgentId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 Agent 名称，或先修改冲突 Agent 的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "agent.list",
              input: { pageSize: 20 },
              reason: "列出已有 Agent 以确认可用名称。",
            },
            operation: "update",
            entity: "agent",
            durationMs: Date.now() - start,
          });
        }
      }

      const updateData: any = { ...data, name };
      if (tools !== undefined) {
        updateData.tools = tools.join(",");
      }

      const agent = await ctx.prisma.agent.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: formatAgent(agent),
        state: { totalAgents: await ctx.prisma.agent.count() },
        operation: "update",
        entity: "agent",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "agent", "AGENT_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.agent.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "AGENT_NOT_FOUND",
          message: `删除 Agent 失败：id 为 "${input.id}" 的 Agent 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 agent.list 确认要删除的 Agent id。",
          retryable: false,
          suggestedAction: {
            procedure: "agent.list",
            input: { pageSize: 20 },
            reason: "列出 Agent 以获取正确的 id。",
          },
          operation: "delete",
          entity: "agent",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.agent.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalAgents: await ctx.prisma.agent.count() },
        nextSteps: [
          {
            action: "创建新 Agent",
            procedure: "agent.create",
            reason: "已删除的 Agent 无法恢复，可创建新 Agent 替代。",
          },
        ],
        operation: "delete",
        entity: "agent",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "agent", "AGENT_DELETE_FAILED");
    }
  }),
});
