import fs from "fs";
import path from "path";
import { TRPCError } from "@trpc/server";
import { createPromptSchema, updatePromptSchema, listPromptsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

let promptsDir = path.resolve(process.cwd(), "content/prompts");
if (!fs.existsSync(promptsDir)) {
  promptsDir = path.resolve(process.cwd(), "../../content/prompts");
}

function formatPrompt(prompt: any) {
  return {
    ...prompt,
    variables: prompt.variables ? prompt.variables.split(",").filter(Boolean).map((v: string) => v.trim()) : [],
    tags: prompt.tags ? prompt.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
  };
}

function writePromptToMarkdown(
  slug: string,
  name: string,
  version: string,
  description: string | null,
  variables: string,
  tags: string,
  content: string
) {
  if (!fs.existsSync(promptsDir)) {
    return;
  }
  const filePath = path.join(promptsDir, `${slug}.md`);
  const variablesList = variables ? variables.split(",").filter(Boolean) : [];
  const variablesYaml = variablesList.length > 0
    ? `\nvariables:\n` + variablesList.map((v) => `  - "${v.replace(/"/g, '\\"')}"`).join("\n")
    : "";
  const tagsList = tags ? tags.split(",").filter(Boolean) : [];
  const tagsYaml = tagsList.length > 0
    ? `\ntags:\n` + tagsList.map((t) => `  - "${t.replace(/"/g, '\\"')}"`).join("\n")
    : "";

  const fileContent = `---
name: "${name.replace(/"/g, '\\"')}"
version: "${version.replace(/"/g, '\\"')}"${variablesYaml}${tagsYaml}
description: ${description ? `"${description.replace(/"/g, '\\"')}"` : "null"}
---
${content}
`;
  fs.writeFileSync(filePath, fileContent, "utf-8");
}

function deleteMarkdownFile(slug: string) {
  if (!fs.existsSync(promptsDir)) return;
  const filePath = path.join(promptsDir, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`❌ 删除文件 ${filePath} 失败:`, err);
    }
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80)
    .concat("-", Date.now().toString(36));
}

export const promptRouter = router({
  create: publicProcedure.input(createPromptSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.prompt.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "PROMPT_NAME_CONFLICT",
          message: `创建 Prompt 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 Prompt 占用。`,
          details: { name: input.name, existingPromptId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 Prompt 名称，或先修改冲突 Prompt 的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "prompt.list",
            input: { pageSize: 20 },
            reason: "列出已有 Prompt 以确认可用名称。",
          },
          operation: "create",
          entity: "prompt",
          durationMs: Date.now() - start,
        });
      }

      const variablesStr = input.variables.join(",");
      const tagsStr = input.tags.join(",");

      const prompt = await ctx.prisma.prompt.create({
        data: {
          name: input.name,
          version: input.version,
          description: input.description,
          variables: variablesStr,
          tags: tagsStr,
          content: input.content,
        },
      });

      writePromptToMarkdown(
        slugify(input.name),
        prompt.name,
        prompt.version,
        prompt.description,
        prompt.variables,
        prompt.tags,
        prompt.content
      );

      return success({
        data: formatPrompt(prompt),
        state: { totalPrompts: await ctx.prisma.prompt.count() },
        nextSteps: [
          {
            action: "查看新创建的 Prompt",
            procedure: "prompt.getById",
            input: { id: prompt.id },
            reason: "可立即查看 Prompt 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "prompt",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "prompt", "PROMPT_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const prompt = await ctx.prisma.prompt.findUnique({ where: { id: input.id } });
    if (!prompt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "提示词不存在" });
    }
    return formatPrompt(prompt);
  }),

  list: publicProcedure.input(listPromptsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword, tag } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (tag) where.tags = { contains: tag };
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { content: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.prompt.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.prompt.count({ where }),
    ]);

    return {
      items: items.map(formatPrompt),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updatePromptSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, variables, tags, name, ...data } = input;

    try {
      const existing = await ctx.prisma.prompt.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "PROMPT_NOT_FOUND",
          message: `更新 Prompt 失败：id 为 "${id}" 的 Prompt 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 prompt.list 查询可用 Prompt，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "prompt.list",
            input: { pageSize: 20 },
            reason: "列出最近 Prompt 以获取正确的 id。",
          },
          operation: "update",
          entity: "prompt",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.prompt.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "PROMPT_NAME_CONFLICT",
            message: `更新 Prompt 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 Prompt 占用。`,
            details: { name, existingPromptId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 Prompt 名称，或先修改冲突 Prompt 的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "prompt.list",
              input: { pageSize: 20 },
              reason: "列出已有 Prompt 以确认可用名称。",
            },
            operation: "update",
            entity: "prompt",
            durationMs: Date.now() - start,
          });
        }
      }

      const updateData: any = { ...data, name };
      if (variables !== undefined) updateData.variables = variables.join(",");
      if (tags !== undefined) updateData.tags = tags.join(",");

      const prompt = await ctx.prisma.prompt.update({
        where: { id },
        data: updateData,
      });

      writePromptToMarkdown(
        slugify(prompt.name),
        prompt.name,
        prompt.version,
        prompt.description,
        prompt.variables,
        prompt.tags,
        prompt.content
      );

      return success({
        data: formatPrompt(prompt),
        state: { totalPrompts: await ctx.prisma.prompt.count() },
        operation: "update",
        entity: "prompt",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "prompt", "PROMPT_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.prompt.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "PROMPT_NOT_FOUND",
          message: `删除 Prompt 失败：id 为 "${input.id}" 的 Prompt 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 prompt.list 确认要删除的 Prompt id。",
          retryable: false,
          suggestedAction: {
            procedure: "prompt.list",
            input: { pageSize: 20 },
            reason: "列出 Prompt 以获取正确的 id。",
          },
          operation: "delete",
          entity: "prompt",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.prompt.delete({ where: { id: input.id } });

      deleteMarkdownFile(slugify(existing.name));

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalPrompts: await ctx.prisma.prompt.count() },
        nextSteps: [
          {
            action: "创建新 Prompt",
            procedure: "prompt.create",
            reason: "已删除的 Prompt 无法恢复，可创建新 Prompt 替代。",
          },
        ],
        operation: "delete",
        entity: "prompt",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "prompt", "PROMPT_DELETE_FAILED");
    }
  }),
});
