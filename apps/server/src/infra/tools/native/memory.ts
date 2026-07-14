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
  const memory = await repo.write({
    content,
    type: rawType as MemoryUserCreatableType,
    scope,
    strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1,
    keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
  });
  return { id: memory.id, type: memory.type, strength: memory.strength, keywords: memory.keywords, scope: memory.scope };
}

async function memorySearchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const keyword = String(args.keyword || "");
  const type = args.type ? String(args.type) : undefined;
  const pageSize = Math.min(50, Math.max(1, Number(args.pageSize || 20)));
  // W5-followup：三层 scope 读路径（global + 本 Agent 所在 Workspace + 本 Agent），
  // 其他 Agent / 其他 Workspace 的私有记忆不可见。仓储不按页返回，page 参数保留兼容但不再翻页。
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
    page: 1,
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
    description: "在本地知识库中创建一篇 Markdown 文章（content/posts）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "文章标题" },
        content: { type: "string", description: "Markdown 正文" },
        slug: { type: "string", description: "URL 标识，不填则自动生成" },
        excerpt: { type: "string", description: "摘要" },
        coverImage: { type: "string", description: "封面图 URL" },
        category: { type: "string", description: "分类" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
        published: { type: "boolean", description: "是否发布" },
      },
      required: ["title"],
    },
  },
  {
    name: "post_update",
    description: "更新本地知识库中的 Markdown 文章。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "文章 id" },
        title: { type: "string", description: "文章标题" },
        content: { type: "string", description: "Markdown 正文" },
        slug: { type: "string", description: "URL 标识" },
        excerpt: { type: "string", description: "摘要" },
        coverImage: { type: "string", description: "封面图 URL" },
        category: { type: "string", description: "分类" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
        published: { type: "boolean", description: "是否发布" },
      },
      required: ["id"],
    },
  },
  {
    name: "post_delete",
    description: "删除本地知识库中的 Markdown 文章。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "文章 id" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_create",
    description:
      "创建长期记忆。type：preference=用户偏好；semantic=稳定事实/决策；episodic=某次经历；note=笔记；procedural=操作流程。scope：agent=仅自己可见（默认）；workspace=同 Workspace 的 Agent 共享；global=全局共享（仅超级 Agent）。不要记可从代码/git/文档直接查到的内容。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "记忆内容" },
        type: {
          type: "string",
          enum: ["preference", "semantic", "episodic", "note", "procedural"],
          description: "记忆类型",
        },
        strength: { type: "number", description: "强度 0-1，默认 1" },
        keywords: { type: "array", items: { type: "string" }, description: "检索关键词" },
        scope: {
          type: "string",
          enum: ["agent", "workspace", "global"],
          description: "可见范围：agent=仅自己（默认）；workspace=同 Workspace 共享；global=全局（仅超级 Agent）",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description: "搜索本地记忆库。",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "关键词" },
        type: { type: "string", description: "按类型过滤" },
        page: { type: "number", description: "页码，默认 1" },
        pageSize: { type: "number", description: "每页条数，默认 20" },
      },
    },
  },
  {
    name: "memory_delete",
    description: "删除本地记忆库中的一条记忆。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "记忆 id" },
      },
      required: ["id"],
    },
  },
];

const MEMORY_HANDLERS: Record<string, NativeToolHandler> = {
  post_create: postCreateTool,
  post_update: postUpdateTool,
  post_delete: postDeleteTool,
  memory_create: memoryCreateTool,
  memory_search: memorySearchTool,
  memory_delete: memoryDeleteTool,
};

export function registerMemoryTools(): void {
  registerNativeDomain(MEMORY_DEFS, MEMORY_HANDLERS);
}
