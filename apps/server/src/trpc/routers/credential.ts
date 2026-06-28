import { TRPCError } from "@trpc/server";
import { createCredentialSchema, updateCredentialSchema, listCredentialsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatCredential(credential: any) {
  return {
    ...credential,
    scope: credential.scope ? credential.scope.split(",").filter(Boolean).map((s: string) => s.trim()) : [],
  };
}

function parseLastUsedAt(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? new Date(value) : value;
}

export const credentialRouter = router({
  create: publicProcedure.input(createCredentialSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.credential.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "CREDENTIAL_NAME_CONFLICT",
          message: `创建 Credential 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 Credential 占用。`,
          details: { name: input.name, existingCredentialId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 Credential 名称，或先修改冲突 Credential 的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "credential.list",
            input: { pageSize: 20 },
            reason: "列出已有 Credential 以确认可用名称。",
          },
          operation: "create",
          entity: "credential",
          durationMs: Date.now() - start,
        });
      }

      const credential = await ctx.prisma.credential.create({
        data: {
          name: input.name,
          type: input.type,
          value: input.value,
          scope: input.scope.join(","),
          lastUsedAt: parseLastUsedAt(input.lastUsedAt),
        },
      });

      return success({
        data: formatCredential(credential),
        state: { totalCredentials: await ctx.prisma.credential.count() },
        nextSteps: [
          {
            action: "查看新创建的 Credential",
            procedure: "credential.getById",
            input: { id: credential.id },
            reason: "可立即查看 Credential 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "credential",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "credential", "CREDENTIAL_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const credential = await ctx.prisma.credential.findUnique({ where: { id: input.id } });
    if (!credential) {
      throw new TRPCError({ code: "NOT_FOUND", message: "凭据不存在" });
    }
    return formatCredential(credential);
  }),

  list: publicProcedure.input(listCredentialsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, type, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (type) where.type = type;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.credential.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.credential.count({ where }),
    ]);

    return {
      items: items.map(formatCredential),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateCredentialSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, name, scope, lastUsedAt, ...data } = input;

    try {
      const existing = await ctx.prisma.credential.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "CREDENTIAL_NOT_FOUND",
          message: `更新 Credential 失败：id 为 "${id}" 的 Credential 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 credential.list 查询可用 Credential，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "credential.list",
            input: { pageSize: 20 },
            reason: "列出最近 Credential 以获取正确的 id。",
          },
          operation: "update",
          entity: "credential",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.credential.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "CREDENTIAL_NAME_CONFLICT",
            message: `更新 Credential 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 Credential 占用。`,
            details: { name, existingCredentialId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 Credential 名称，或先修改冲突 Credential 的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "credential.list",
              input: { pageSize: 20 },
              reason: "列出已有 Credential 以确认可用名称。",
            },
            operation: "update",
            entity: "credential",
            durationMs: Date.now() - start,
          });
        }
      }

      const updateData: any = { ...data, name };
      if (scope !== undefined) updateData.scope = scope.join(",");
      if (lastUsedAt !== undefined) updateData.lastUsedAt = parseLastUsedAt(lastUsedAt);

      const credential = await ctx.prisma.credential.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: formatCredential(credential),
        state: { totalCredentials: await ctx.prisma.credential.count() },
        operation: "update",
        entity: "credential",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "credential", "CREDENTIAL_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.credential.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "CREDENTIAL_NOT_FOUND",
          message: `删除 Credential 失败：id 为 "${input.id}" 的 Credential 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 credential.list 确认要删除的 Credential id。",
          retryable: false,
          suggestedAction: {
            procedure: "credential.list",
            input: { pageSize: 20 },
            reason: "列出 Credential 以获取正确的 id。",
          },
          operation: "delete",
          entity: "credential",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.credential.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalCredentials: await ctx.prisma.credential.count() },
        nextSteps: [
          {
            action: "创建新 Credential",
            procedure: "credential.create",
            reason: "已删除的 Credential 无法恢复，可创建新 Credential 替代。",
          },
        ],
        operation: "delete",
        entity: "credential",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "credential", "CREDENTIAL_DELETE_FAILED");
    }
  }),
});
