/**
 * file tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { withApprovalGuard } from "./withApprovalGuard.js";
import { createFileSchema, updateFileSchema, listFilesSchema, uploadFileSchema, deleteByIdWithApprovalSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const fileRouter = router({
  upload: publicProcedure.meta({ description: "通过 base64 编码数据上传文件，返回上传后的文件记录和相对 URL。", aiReadable: true }).input(uploadFileSchema).mutation(({ ctx, input }) => ctx.services.file.upload(input)),
  create: publicProcedure.meta({ description: "创建文件元数据记录。", aiReadable: true }).input(createFileSchema).mutation(({ ctx, input }) => ctx.services.file.create(input)),
  getById: publicProcedure.meta({ description: "获取文件元数据。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.file.getById(input.id)),
  list: publicProcedure.meta({ description: "列出上传的文件。", aiReadable: true }).input(listFilesSchema).query(({ ctx, input }) => ctx.services.file.list(input)),
  update: publicProcedure.meta({ description: "更新文件名称。", aiReadable: true }).input(updateFileSchema).mutation(({ ctx, input }) => ctx.services.file.update(input)),
  delete: publicProcedure.meta({ description: "删除文件记录。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "file.delete", { id: input.id }, input.approvalId, () => ctx.services.file.delete(input.id)),
  ),
});
