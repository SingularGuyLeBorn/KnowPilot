import { TRPCError } from "@trpc/server";
import { createFileSchema, updateFileSchema, listFilesSchema, uploadFileSchema } from "@knowpilot/shared";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function ensureUploadsDir(): string {
  const uploadsDir = path.resolve(process.cwd(), "content/uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function sanitizeFileName(name: string): string {
  // 保留中文、英文、数字、点、下划线、连字符，其余替换为下划线
  return name.replace(/[^\w\u4e00-\u9fa5.\-]/g, "_").replace(/_{2,}/g, "_");
}

export const fileRouter = router({
  upload: publicProcedure.input(uploadFileSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const uploadsDir = ensureUploadsDir();
      const timestamp = Date.now();
      const safeName = sanitizeFileName(input.name);
      const fileName = `${timestamp}-${safeName}`;
      const filePath = path.join(uploadsDir, fileName);

      const buffer = Buffer.from(input.data, "base64");
      if (buffer.length !== input.size) {
        return failure({
          code: "FILE_SIZE_MISMATCH",
          message: "上传文件大小与声明不一致，请重试。",
          details: { expected: input.size, actual: buffer.length },
          retryable: true,
          operation: "upload",
          entity: "file",
          durationMs: Date.now() - start,
        });
      }

      // 限制单文件 20MB
      const MAX_SIZE = 20 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        return failure({
          code: "FILE_TOO_LARGE",
          message: "文件大小超过 20MB 限制。",
          details: { maxBytes: MAX_SIZE, actual: buffer.length },
          retryable: false,
          operation: "upload",
          entity: "file",
          durationMs: Date.now() - start,
        });
      }

      fs.writeFileSync(filePath, buffer);

      const url = `/uploads/${fileName}`;
      const file = await ctx.prisma.file.create({
        data: {
          name: input.name,
          path: filePath,
          mimeType: input.mimeType,
          size: input.size,
          url,
        },
      });

      return success({
        data: { file, url },
        state: { totalFiles: await ctx.prisma.file.count() },
        nextSteps: [
          {
            action: "在 Markdown 中引用图片",
            procedure: "post.update",
            reason: `可使用 ![${input.name}](${url}) 引用该文件。`,
          },
        ],
        operation: "upload",
        entity: "file",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "upload", "file", "FILE_UPLOAD_FAILED");
    }
  }),

  create: publicProcedure.input(createFileSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const file = await ctx.prisma.file.create({
        data: input,
      });

      return success({
        data: file,
        state: { totalFiles: await ctx.prisma.file.count() },
        nextSteps: [
          {
            action: "查看新创建的文件记录",
            procedure: "file.getById",
            input: { id: file.id },
            reason: "可立即查看文件记录详情。",
          },
        ],
        operation: "create",
        entity: "file",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "file", "FILE_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } });
    if (!file) {
      throw new TRPCError({ code: "NOT_FOUND", message: "文件记录不存在" });
    }
    return file;
  }),

  list: publicProcedure.input(listFilesSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.name = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      ctx.prisma.file.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      ctx.prisma.file.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateFileSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.file.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "FILE_NOT_FOUND",
          message: `更新 File 失败：id 为 "${id}" 的文件记录不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 file.list 查询可用文件记录，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "file.list",
            input: { pageSize: 20 },
            reason: "列出最近文件记录以获取正确的 id。",
          },
          operation: "update",
          entity: "file",
          durationMs: Date.now() - start,
        });
      }

      const file = await ctx.prisma.file.update({
        where: { id },
        data,
      });

      return success({
        data: file,
        state: { totalFiles: await ctx.prisma.file.count() },
        operation: "update",
        entity: "file",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "file", "FILE_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.file.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "FILE_NOT_FOUND",
          message: `删除 File 失败：id 为 "${input.id}" 的文件记录不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 file.list 确认要删除的文件记录 id。",
          retryable: false,
          suggestedAction: {
            procedure: "file.list",
            input: { pageSize: 20 },
            reason: "列出文件记录以获取正确的 id。",
          },
          operation: "delete",
          entity: "file",
          durationMs: Date.now() - start,
        });
      }

      // 注意：在此处仅删除数据库记录。物理文件删除可根据实际业务进一步补充。
      await ctx.prisma.file.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalFiles: await ctx.prisma.file.count() },
        operation: "delete",
        entity: "file",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "file", "FILE_DELETE_FAILED");
    }
  }),
});
