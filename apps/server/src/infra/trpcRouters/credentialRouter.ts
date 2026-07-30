/**
 * credential tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { createCredentialSchema, updateCredentialSchema, listCredentialsSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { getEnvCredentialCandidates } from "../credentialVault.js";

export const credentialRouter = router({
  create: publicProcedure.meta({ description: "创建凭据。name 必须唯一。", aiReadable: true }).input(createCredentialSchema).mutation(({ ctx, input }) => ctx.services.credential.create(input)),
  // 安全：getById / list 不对 AI 反射开放（aiReadable: false），防止 Agent 通过 ai.invoke 拖走全部密钥。
  getById: publicProcedure.meta({ description: "获取凭据详情（返回遮蔽预览，不含明文）。", aiReadable: false }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.credential.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有凭据（返回遮蔽预览，不含明文）。", aiReadable: false }).input(listCredentialsSchema).query(({ ctx, input }) => ctx.services.credential.list(input)),
  update: publicProcedure.meta({ description: "更新凭据。", aiReadable: true }).input(updateCredentialSchema).mutation(({ ctx, input }) => ctx.services.credential.update(input)),
  delete: publicProcedure.meta({ description: "删除凭据。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.credential.delete(input.id)),
  importFromEnv: publicProcedure
    .meta({ description: "从 .env 导入集成密钥到 Credential 表（不覆盖已存在）。", aiReadable: true })
    .mutation(async ({ ctx }) => {
      const candidates = getEnvCredentialCandidates();
      const existing = await ctx.prisma.credential.findMany({ select: { name: true } });
      const existingNames = new Set(existing.map((e) => e.name));
      const imported: string[] = [];
      const skipped: string[] = [];
      for (const c of candidates) {
        if (existingNames.has(c.name)) {
          skipped.push(c.name);
          continue;
        }
        await ctx.services.credential.create(c as any);
        imported.push(c.name);
      }
      return { imported, skipped, total: candidates.length };
    }),
});

