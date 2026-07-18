/**
 * Native 知识与记忆域 — post_*（本地知识库 Markdown）+ memory_*（长期记忆）
 *
 * PR-4b：从 nativeTools.ts 迁出，handler 与 schema 保持原语义不变。
 */
import {
  isMemoryUserCreatable,
  MEMORY_SCOPE_GLOBAL,
  memoryAgentScope,
  memoryWorkspaceScope,
  type MemoryUserCreatableType,
} from "@knowpilot/shared";
import type { PostEntity } from "../../../services.js";
import { createMemoryRepository, resolveMemoryWriteScope } from "../../memoryRepository.js";
import { readPinnedFile, writePinnedFile, type PinnedWhich } from "../../pinnedMemory.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import type { ToolRollback } from "../types.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

async function postCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const title = String(args.title || "").trim();
  if (!title) throw new Error("title 不能为空");
  const input = {
    title,
    content: String(args.content ?? ""),
    slug: args.slug ? String(args.slug) : undefined,
    excerpt: args.excerpt ? String(args.excerpt) : undefined,
    coverImage: args.coverImage ? String(args.coverImage) : null,
    category: args.category ? String(args.category) : null,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    published: args.published === true,
  };
  const result = await ctx.services.post.create(input);
  if (!result.success) throw new Error(result.error?.message || "创建文章失败");
  const post = result.data as PostEntity;
  return { id: post.id, slug: post.slug, title: post.title };
}

async function postUpdateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const input = {
    id,
    title: args.title !== undefined ? String(args.title) : undefined,
    content: args.content !== undefined ? String(args.content) : undefined,
    slug: args.slug !== undefined ? String(args.slug) : undefined,
    excerpt: args.excerpt !== undefined ? String(args.excerpt) : undefined,
    coverImage: args.coverImage !== undefined ? (args.coverImage ? String(args.coverImage) : null) : undefined,
    category: args.category !== undefined ? (args.category ? String(args.category) : null) : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    published: args.published !== undefined ? args.published === true : undefined,
  };
  const result = await ctx.services.post.update(input);
  if (!result.success) throw new Error(result.error?.message || "更新文章失败");
  const post = result.data as PostEntity;
  return { id: post.id, slug: post.slug, title: post.title };
}

async function postDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const result = await ctx.services.post.delete(id);
  if (!result.success) throw new Error(result.error?.message || "删除文章失败");
  return { id, deleted: true };
}

async function memoryCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const content = String(args.content || "").trim();
  if (!content) throw new Error("content 不能为空");
  const strength = Number(args.strength ?? 1);
  const rawType = args.type ? String(args.type) : "note";
  if (!isMemoryUserCreatable(rawType)) {
    throw new Error(
      `type 无效：${rawType}。允许：preference（偏好）、semantic（事实）、episodic（经历）、note（笔记）、procedural（流程）。不要记可从代码/文档直接查到的内容。`,
    );
  }
  const scope = resolveMemoryWriteScope(args.scope ? String(args.scope) : undefined, {
    agentId: ctx.agentSnapshot?.id,
    workspaceId: ctx.agentSnapshot?.workspaceId,
    tier: ctx.agentSnapshot?.tier,
  });
  const repo = createMemoryRepository(ctx.services);
  const attributionRaw = args.attribution ? String(args.attribution) : "agent";
  const attribution = ["user", "agent", "system"].includes(attributionRaw)
    ? attributionRaw
    : "agent";
  let validTo: Date | null | undefined;
  if (args.validTo) {
    const d = new Date(String(args.validTo));
    if (!Number.isNaN(d.getTime())) validTo = d;
  }
  const memory = await repo.write({
    content,
    type: rawType as MemoryUserCreatableType,
    scope,
    strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1,
    keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
    attribution,
    validTo,
  });
  return {
    id: memory.id,
    type: memory.type,
    strength: memory.strength,
    keywords: memory.keywords,
    scope: memory.scope,
    attribution: memory.attribution,
  };
}

async function pinnedMemoryReadTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const which = String(args.which || "").trim() as PinnedWhich;
  if (which !== "user" && which !== "agent") {
    throw new Error("which 必须是 user 或 agent");
  }
  return readPinnedFile(ctx.config.projectRoot, which);
}

async function pinnedMemoryWriteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const which = String(args.which || "").trim() as PinnedWhich;
  if (which !== "user" && which !== "agent") {
    throw new Error("which 必须是 user 或 agent");
  }
  const content = String(args.content ?? "");
  if (!content.trim()) throw new Error("content 不能为空");
  return writePinnedFile(ctx.config.projectRoot, which, content);
}

async function memorySearchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const keyword = String(args.keyword || "");
  const type = args.type ? String(args.type) : undefined;
  const pageSize = Math.min(50, Math.max(1, Number(args.pageSize || 20)));
  // W5-followup：三层 scope 读路径（global + 本 Agent 所在 Workspace + 本 Agent），
  // 其他 Agent / 其他 Workspace 的私有记忆不可见。仓储一次返回 limit 条，不分页。
  const scopes = [MEMORY_SCOPE_GLOBAL];
  if (ctx.agentSnapshot?.workspaceId) scopes.push(memoryWorkspaceScope(ctx.agentSnapshot.workspaceId));
  if (ctx.agentSnapshot?.id) scopes.push(memoryAgentScope(ctx.agentSnapshot.id));
  const repo = createMemoryRepository(ctx.services);
  const items = await repo.read({
    keyword: keyword || undefined,
    types: type ? [type] : undefined,
    scopes,
    limit: pageSize,
  });
  return {
    total: items.length,
    pageSize,
    items: items.map((m) => ({
      id: m.id,
      content: m.content.slice(0, 200),
      type: m.type,
      strength: m.strength,
      keywords: m.keywords,
    })),
  };
}

async function memoryUpdateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  const content = String(args.content || "").trim();
  if (!id) throw new Error("id 不能为空");
  if (!content) throw new Error("content 不能为空");
  const rawType = args.type !== undefined ? String(args.type) : undefined;
  if (rawType !== undefined && !isMemoryUserCreatable(rawType)) {
    throw new Error(
      `type 无效：${rawType}。允许：preference、semantic、episodic、note、procedural。`,
    );
  }
  const strength = args.strength !== undefined ? Number(args.strength) : undefined;
  const repo = createMemoryRepository(ctx.services);
  const { previousId, memory } = await repo.supersedeUpdate({
    id,
    content,
    type: rawType,
    strength: strength !== undefined && Number.isFinite(strength) ? strength : undefined,
    keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : undefined,
    actor: {
      agentId: ctx.agentSnapshot?.id,
      workspaceId: ctx.agentSnapshot?.workspaceId,
      tier: ctx.agentSnapshot?.tier,
    },
  });
  return {
    id: memory.id,
    previousId,
    type: memory.type,
    strength: memory.strength,
    keywords: memory.keywords,
    scope: memory.scope,
    superseded: previousId !== memory.id,
  };
}

async function memoryDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const result = await ctx.services.memory.delete(id);
  if (!result.success) throw new Error(result.error?.message || "删除记忆失败");
  return { id, deleted: true };
}

const MEMORY_DEFS: NativeToolDefinition[] = [
  {
    name: "post_create",
    concurrencyClass: "D",
    destructive: true,
    description: "在本地知识库中创建一篇 Markdown 文章（content/posts）。",
    parameters: zodParams(
      z.object({
        title: z.string().describe("文章标题"),
        content: z.string().describe("Markdown 正文").optional(),
        slug: z.string().describe("URL 标识，不填则自动生成").optional(),
        excerpt: z.string().describe("摘要").optional(),
        coverImage: z.string().describe("封面图 URL").optional(),
        category: z.string().describe("分类").optional(),
        tags: z.array(z.string()).describe("标签列表").optional(),
        published: z.boolean().describe("是否发布").optional(),
      }),
    ),
  },
  {
    name: "post_update",
    concurrencyClass: "D",
    description: "更新本地知识库中的 Markdown 文章。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("文章 id"),
        title: z.string().describe("文章标题").optional(),
        content: z.string().describe("Markdown 正文").optional(),
        slug: z.string().describe("URL 标识").optional(),
        excerpt: z.string().describe("摘要").optional(),
        coverImage: z.string().describe("封面图 URL").optional(),
        category: z.string().describe("分类").optional(),
        tags: z.array(z.string()).describe("标签列表").optional(),
        published: z.boolean().describe("是否发布").optional(),
      }),
    ),
  },
  {
    name: "post_delete",
    concurrencyClass: "D",
    destructive: true,
    description: "删除本地知识库中的 Markdown 文章。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("文章 id"),
      }),
    ),
  },
  {
    name: "memory_create",
    concurrencyClass: "D",
    destructive: true,
    description:
      "创建长期记忆。type：preference=用户偏好；semantic=稳定事实/决策；episodic=某次经历；note=笔记；procedural=操作流程。scope：agent=仅自己可见（默认）；workspace=同 Workspace 的 Agent 共享；global=全局共享（仅超级 Agent）。不要记可从代码/git/文档直接查到的内容。若发现与已有记忆矛盾或事实过时，请用 memory_update（勿重复 create）。",
    parameters: zodParams(
      z.object({
        content: z.string().describe("记忆内容"),
        type: z
          .enum(["preference", "semantic", "episodic", "note", "procedural"])
          .describe("记忆类型")
          .optional(),
        strength: z.number().describe("强度 0-1，默认 1").optional(),
        keywords: z.array(z.string()).describe("检索关键词").optional(),
        scope: z
          .enum(["agent", "workspace", "global"])
          .describe("可见范围：agent=仅自己（默认）；workspace=同 Workspace 共享；global=全局（仅超级 Agent）")
          .optional(),
        attribution: z
          .enum(["user", "agent", "system"])
          .describe("事实来源：user=用户陈述；agent=Agent 推断（默认）；system=系统")
          .optional(),
        validTo: z
          .string()
          .describe("可选 ISO 时间：事实失效点（过期后不再检索/注入）")
          .optional(),
      }),
    ),
  },
  {
    name: "memory_update",
    concurrencyClass: "D",
    destructive: true,
    description:
      "更新长期记忆（软版本链）：新建现行版本，旧版标为 superseded 不再注入上下文。用于纠正矛盾或过时事实；可传已 superseded 的旧 id（自动跟到链尾）。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("要更新的记忆 id（search/create 返回的 id）"),
        content: z.string().describe("新的记忆内容"),
        type: z
          .enum(["preference", "semantic", "episodic", "note", "procedural"])
          .describe("记忆类型（不填则继承）")
          .optional(),
        strength: z.number().describe("强度 0-1（不填则继承）").optional(),
        keywords: z.array(z.string()).describe("检索关键词（不填则继承）").optional(),
      }),
    ),
  },
  {
    name: "memory_search",
    reentrant: true, // 只读搜索
    description: "搜索本地记忆库（仅返回现行 active 版本）。",
    parameters: zodParams(
      z.object({
        keyword: z.string().describe("关键词").optional(),
        type: z.string().describe("按类型过滤").optional(),
        pageSize: z.number().describe("返回条数上限，默认 20").optional(),
      }),
    ),
  },
  {
    name: "memory_delete",
    concurrencyClass: "D",
    destructive: true,
    description: "删除本地记忆库中的一条记忆。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("记忆 id"),
      }),
    ),
  },
  {
    name: "pinned_memory_read",
    reentrant: true,
    description:
      "读取 L1 常驻层 USER.md（用户偏好）或 AGENT.md（工作约定）。硬预算截断后的正文；会话内注入的是冻结快照，本工具读的是磁盘当前内容。",
    parameters: zodParams(
      z.object({
        which: z.enum(["user", "agent"]).describe("user=USER.md；agent=AGENT.md"),
      }),
    ),
  },
  {
    name: "pinned_memory_write",
    concurrencyClass: "D",
    destructive: true,
    description:
      "写入 L1 常驻层 USER.md / AGENT.md（超硬预算自动截断）。立即写盘；当前会话仍用冻结快照，**新会话**才注入更新后的内容。勿把可检索的琐碎事实写进这里——琐碎事实用 memory_create。",
    parameters: zodParams(
      z.object({
        which: z.enum(["user", "agent"]).describe("user=USER.md；agent=AGENT.md"),
        content: z.string().describe("完整替换正文（Markdown）"),
      }),
    ),
  },
];

const MEMORY_HANDLERS: Record<string, NativeToolHandler> = {
  post_create: postCreateTool,
  post_update: postUpdateTool,
  post_delete: postDeleteTool,
  memory_create: memoryCreateTool,
  memory_update: memoryUpdateTool,
  memory_search: memorySearchTool,
  memory_delete: memoryDeleteTool,
  pinned_memory_read: pinnedMemoryReadTool,
  pinned_memory_write: pinnedMemoryWriteTool,
};

/** create 类补偿共用：按结果 id 走 Service 删除（保证文件回写 / FTS 同步）；NOT_FOUND 幂等跳过 */
async function deleteByIdCompensate(
  entity: "post" | "memory",
  result: unknown,
  ctx: NativeToolContext,
): Promise<string> {
  const id = (result as { id?: string } | undefined)?.id;
  if (!id) return "执行结果无 id，幂等跳过";
  const del = await ctx.services[entity].delete(id);
  if (!del.success) {
    if (del.error?.code?.includes("NOT_FOUND")) return "记录已不存在（视为已回滚），幂等跳过";
    throw new Error(del.error?.message || `${entity} 删除回补失败`);
  }
  return `已删除本 run 创建的 ${entity}（id=${id}）`;
}

/**
 * D 类工具幂等补偿（W6）：post_create / memory_create 回滚 = 删除该 id（走 Service）。
 * post_delete / memory_delete 为不可逆删除，不挂补偿（run 失败时如实 warn「需人工 revert」）。
 */
const MEMORY_ROLLBACKS: Record<string, ToolRollback<NativeToolContext>> = {
  post_create: {
    compensate: async (_args, result, _captured, ctx) => deleteByIdCompensate("post", result, ctx),
  },
  memory_create: {
    compensate: async (_args, result, _captured, ctx) => deleteByIdCompensate("memory", result, ctx),
  },
};

export function registerMemoryTools(): void {
  registerNativeDomain(MEMORY_DEFS, MEMORY_HANDLERS, MEMORY_ROLLBACKS);
}
