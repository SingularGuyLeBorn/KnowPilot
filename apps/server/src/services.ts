/**
 * KnowPilot 后端服务业务层 (Services Layer)
 *
 * 【扁平化单文件设计】：
 * 1. 包含 Service 错误定义、CRUD 基类 BaseService 与文件同步 FileSyncService 基类。
 * 2. 包含系统所有 18 个实体的具体 Service 业务逻辑实现。
 * 3. 杜绝零散同名文件，修改任何业务逻辑统一在此单文件内调整。
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { dump } from "js-yaml";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  type OperationResult,
  type NextStep,
  type CreatePostInput,
  type UpdatePostInput,
  type ListPostsInput,
  type CreateAgentInput,
  type UpdateAgentInput,
  type ListAgentsInput,
  materializeAgentTools,
  type CreateSkillInput,
  type UpdateSkillInput,
  type ListSkillsInput,
  type CreateMcpServerInput,
  type UpdateMcpServerInput,
  type ListMcpServersInput,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type ListMemoriesInput,
  type CreateSessionInput,
  type UpdateSessionInput,
  type ListSessionsInput,
  type CreateMessageInput,
  type UpdateMessageInput,
  type ListMessagesInput,
  type CreateFileInput,
  type UpdateFileInput,
  type ListFilesInput,
  type CreateLogInput,
  type UpdateLogInput,
  type ListLogsInput,
  type CreateGitRepoInput,
  type UpdateGitRepoInput,
  type ListGitReposInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type ListTasksInput,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type ListWorkspacesInput,
  type CreateTriggerInput,
  type UpdateTriggerInput,
  type ListTriggersInput,
  type CreateApprovalInput,
  type UpdateApprovalInput,
  type ListApprovalsInput,
  type CreateToolInput,
  type UpdateToolInput,
  type ListToolsInput,
  type CreateRunInput,
  type UpdateRunInput,
  type ListRunsInput,
  type CreatePromptInput,
  type UpdatePromptInput,
  type ListPromptsInput,
  type CreateCredentialInput,
  type UpdateCredentialInput,
  type ListCredentialsInput,
  type CreateInfoSourceInput,
  type UpdateInfoSourceInput,
  type ListInfoSourcesInput,
  type AgentRunInput,
  type AgentChatInput,
  type WebSearchInput,
  type GitRepoPathInput,
  type NativeExecuteInput,
} from "@knowpilot/shared";
import { success, failure, failureFromError } from "./trpc/result.js";
import type { AppEventBus } from "./infra/eventBus.js";
import type { AppConfig } from "./infra/config.js";
import { encryptCredentialValue, decryptCredentialValue, maskSecret } from "./infra/credentialVault.js";
import { resolveSafePath, assertPathWithinProjectRoot } from "./infra/safePath.js";

/* ─── 1. 辅助类型与基类 ─── */

/** 安全 JSON.parse：失败时返回 null 并 warn，避免坏数据致 list 整体崩溃。 */
function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BasePaginationInput {
  page: number;
  pageSize: number;
  keyword?: string;
}

export class ServiceValidationError extends Error {
  constructor(public readonly result: OperationResult<never>) {
    super(result.error?.message || "Validation failed");
    this.name = "ServiceValidationError";
  }
}

/**
 * BaseService — 通用 CRUD 业务基类
 */
export abstract class BaseService<
  TCreate,
  TUpdate extends { id: string },
  TList extends BasePaginationInput,
  TEntity,
> {
  constructor(
    protected readonly prisma: PrismaClient,
    protected readonly eventBus: AppEventBus,
    protected readonly config: AppConfig,
  ) {}

  abstract readonly entityName: string;
  protected abstract get delegate(): any;
  protected abstract formatEntity(raw: any): TEntity;
  protected abstract buildListWhere(input: TList): any;
  protected abstract buildCreateData(input: TCreate): any;
  protected abstract buildUpdateData(input: TUpdate): any;

  protected get defaultOrderBy(): string { return "createdAt"; }
  protected get defaultOrder(): "asc" | "desc" { return "desc"; }

  protected getOrderBy(input: TList): any {
    const orderBy = (input as any).orderBy || this.defaultOrderBy;
    const order = (input as any).order || this.defaultOrder;
    return { [orderBy]: order };
  }

  protected getListSelect(): any | undefined { return undefined; }
  protected async validateCreate(_input: TCreate): Promise<void> {}
  protected async validateUpdate(_input: TUpdate, _existing: any): Promise<void> {}

  protected async afterCreate(entity: TEntity, _input: TCreate): Promise<void> {
    this.eventBus.emit(`${this.entityName}.created`, entity);
  }

  protected async afterUpdate(entity: TEntity, _existing: any, _input: TUpdate): Promise<void> {
    this.eventBus.emit(`${this.entityName}.updated`, entity);
  }

  protected async afterDelete(existing: any): Promise<void> {
    this.eventBus.emit(`${this.entityName}.deleted`, existing);
  }

  protected async getState(): Promise<Record<string, unknown>> {
    const total = await this.delegate.count();
    return { [`total${this.entityName.charAt(0).toUpperCase() + this.entityName.slice(1)}s`]: total };
  }

  protected getCreateNextSteps(entity: TEntity): NextStep[] {
    return [
      {
        action: `查看新创建的 ${this.entityName}`,
        procedure: `${this.entityName}.getById`,
        input: { id: (entity as any).id },
        reason: `可立即查看详情。`,
      },
    ];
  }

  protected getDeleteNextSteps(): NextStep[] {
    return [
      {
        action: `创建新 ${this.entityName}`,
        procedure: `${this.entityName}.create`,
        reason: `已删除的记录无法恢复，可创建新记录替代。`,
      },
    ];
  }

  protected buildNotFoundFailure(operation: string, id: string, durationMs: number): OperationResult<never> {
    return failure({
      code: `${this.entityName.toUpperCase()}_NOT_FOUND`,
      message: `${operation} ${this.entityName} 失败：id 为 "${id}" 的记录不存在。`,
      details: { id },
      field: "id",
      suggestion: `请识别正确的 id 重试。`,
      retryable: false,
      operation,
      entity: this.entityName,
      durationMs,
    });
  }

  async getById(id: string): Promise<TEntity> {
    const raw = await this.delegate.findUnique({ where: { id } });
    if (!raw) {
      throw new TRPCError({ code: "NOT_FOUND", message: `${this.entityName} 不存在` });
    }
    return this.formatEntity(raw);
  }

  async list(input: TList): Promise<PaginatedResult<TEntity>> {
    const { page, pageSize } = input;
    const skip = (page - 1) * pageSize;
    const where = this.buildListWhere(input);
    const orderBy = this.getOrderBy(input);
    const select = this.getListSelect();

    const findManyArgs: any = { where, skip, take: pageSize, orderBy };
    if (select) findManyArgs.select = select;

    const [rawItems, total] = await Promise.all([
      this.delegate.findMany(findManyArgs),
      this.delegate.count({ where }),
    ]);

    return {
      items: rawItems.map((item: any) => this.formatEntity(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async create(input: TCreate): Promise<OperationResult<TEntity>> {
    const start = Date.now();
    try {
      await this.validateCreate(input);
      const data = this.buildCreateData(input);
      const raw = await this.delegate.create({ data });
      const entity = this.formatEntity(raw);
      await this.afterCreate(entity, input);
      return success({
        data: entity,
        state: await this.getState(),
        nextSteps: this.getCreateNextSteps(entity),
        operation: "create",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  async update(input: TUpdate): Promise<OperationResult<TEntity>> {
    const start = Date.now();
    const { id } = input;
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("更新", id, Date.now() - start);
      await this.validateUpdate(input, existing);
      const updateData = this.buildUpdateData(input);
      const raw = await this.delegate.update({ where: { id }, data: updateData });
      const entity = this.formatEntity(raw);
      await this.afterUpdate(entity, existing, input);
      return success({
        data: entity,
        state: await this.getState(),
        operation: "update",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "update", this.entityName, `${this.entityName.toUpperCase()}_UPDATE_FAILED`);
    }
  }

  async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      await this.delegate.delete({ where: { id } });
      await this.afterDelete(existing);
      return success({
        data: this.buildDeleteSummary(existing),
        state: await this.getState(),
        nextSteps: this.getDeleteNextSteps(),
        operation: "delete",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "delete", this.entityName, `${this.entityName.toUpperCase()}_DELETE_FAILED`);
    }
  }

  protected buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id };
  }

  protected async assertUnique(field: string, value: string, operation: string, excludeId?: string): Promise<void> {
    const where: any = { [field]: value };
    const existing = await this.delegate.findFirst({ where });
    if (existing && existing.id !== excludeId) {
      throw new ServiceValidationError(
        failure({
          code: `${this.entityName.toUpperCase()}_${field.toUpperCase()}_CONFLICT`,
          message: `${operation} ${this.entityName} 失败：${field} "${value}" 已被其他记录占用。`,
          details: { [field]: value, existingId: existing.id },
          field,
          suggestion: `请指定一个不同的 ${field}。`,
          retryable: false,
          operation,
          entity: this.entityName,
        }),
      );
    }
  }
}

/**
 * FileSyncService — 文本化本地实体双写文件基类
 */
export abstract class FileSyncService<
  TCreate,
  TUpdate extends { id: string },
  TList extends BasePaginationInput,
  TEntity,
> extends BaseService<TCreate, TUpdate, TList, TEntity> {
  abstract readonly contentDirName: string;
  abstract readonly fileExtension: string;
  protected abstract serializeToFile(entity: TEntity): string;
  protected abstract getFileSlug(entity: TEntity): string;

  protected getContentDir(): string {
    return (this.config.contentPaths as any)[this.contentDirName] || path.join(this.config.contentDir, this.contentDirName);
  }

  protected writeFile(entity: TEntity): void {
    const dir = this.getContentDir();
    const slug = this.getFileSlug(entity);
    const filePath = path.join(dir, `${slug}${this.fileExtension}`);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, this.serializeToFile(entity), "utf-8");
  }

  protected deleteFile(entity: TEntity): void {
    const dir = this.getContentDir();
    const slug = this.getFileSlug(entity);
    const filePath = path.join(dir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  protected override async afterCreate(entity: TEntity, input: TCreate): Promise<void> {
    this.writeFile(entity);
    await super.afterCreate(entity, input);
  }

  protected override async afterUpdate(entity: TEntity, existing: any, input: TUpdate): Promise<void> {
    const oldSlug = this.getExistingFileSlug(existing);
    const newSlug = this.getFileSlug(entity);
    if (oldSlug && oldSlug !== newSlug) this.deleteFileBySlug(oldSlug);
    this.writeFile(entity);
    await super.afterUpdate(entity, existing, input);
  }

  protected override async afterDelete(existing: any): Promise<void> {
    const slug = this.getExistingFileSlug(existing);
    if (slug) this.deleteFileBySlug(slug);
    await super.afterDelete(existing);
  }

  protected getExistingFileSlug(existing: any): string | null {
    try { return this.getFileSlug(this.formatEntity(existing)); } catch { return null; }
  }

  private deleteFileBySlug(slug: string): void {
    const dir = this.getContentDir();
    const filePath = path.join(dir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}

/* ─── 2. 18 个实体业务逻辑的具体 Service 实现 ─── */

/** Post 文章 */
export interface PostEntity {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  coverImage: string | null;
  published: boolean;
  category: string | null;
  tags: string[];
  viewCount: number;
  metadata: any;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PostService extends FileSyncService<CreatePostInput, UpdatePostInput, ListPostsInput, PostEntity> {
  readonly entityName = "post";
  readonly contentDirName = "posts";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.post; }

  protected formatEntity(raw: any): PostEntity {
    return {
      ...raw,
      tags: raw.tags ? raw.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  protected buildListWhere(input: ListPostsInput): any {
    const where: any = { deletedAt: null };
    if (input.published !== undefined) where.published = input.published;
    if (input.category) where.category = input.category;
    if (input.tag) where.tags = { contains: input.tag };
    if (input.keyword) {
      where.OR = [{ title: { contains: input.keyword } }, { content: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreatePostInput): any {
    const slug = input.slug || this.generateSlug(input.title);
    return {
      title: input.title,
      slug,
      content: input.content,
      published: input.published ?? false,
      excerpt: input.excerpt,
      coverImage: input.coverImage,
      category: input.category,
      tags: input.tags?.join(",") || "",
    };
  }

  protected buildUpdateData(input: UpdatePostInput): any {
    const { id: _id, tags, ...data } = input;
    const updateData: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) updateData[key] = value;
    }
    if (tags !== undefined) updateData.tags = tags.join(",");
    return updateData;
  }

  protected override getListSelect(): any {
    return { id: true, title: true, slug: true, excerpt: true, coverImage: true, published: true, category: true, tags: true, content: true, viewCount: true, createdAt: true, updatedAt: true };
  }

  protected serializeToFile(entity: PostEntity): string {
    const tagsYaml = entity.tags?.length > 0 ? `\ntags:\n` + entity.tags.map((t) => `  - "${t}"`).join("\n") : "";
    return `---
title: "${entity.title.replace(/"/g, '\\"')}"
category: ${entity.category ? `"${entity.category.replace(/"/g, '\\"')}"` : "null"}${tagsYaml}
published: ${entity.published}
excerpt: ${entity.excerpt ? `"${entity.excerpt.replace(/"/g, '\\"')}"` : "null"}
---
${entity.content}
`;
  }

  protected getFileSlug(entity: PostEntity): string { return entity.slug; }

  protected override async validateCreate(input: CreatePostInput): Promise<void> {
    const slug = input.slug || this.generateSlug(input.title);
    await this.assertUnique("slug", slug, "创建");
  }

  protected override async validateUpdate(input: UpdatePostInput, existing: any): Promise<void> {
    if (input.slug && input.slug !== existing.slug) {
      await this.assertUnique("slug", input.slug, "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, slug: existing.slug, title: existing.title };
  }

  async getBySlug(slug: string): Promise<PostEntity> {
    const post = await this.prisma.post.findUnique({ where: { slug, deletedAt: null } });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
    await this.prisma.post.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } });
    return this.formatEntity(post);
  }

  async search(query: string, limit = 10): Promise<PostEntity[]> {
    const rawItems = await this.prisma.post.findMany({
      where: { deletedAt: null, OR: [{ title: { contains: query } }, { content: { contains: query } }] },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return rawItems.map((item: any) => this.formatEntity(item));
  }

  async tree(): Promise<{ id: string; slug: string; title: string }[]> {
    return this.prisma.post.findMany({
      where: { published: true, deletedAt: null },
      select: { id: true, slug: true, title: true },
      orderBy: { slug: "asc" },
    });
  }

  async categories(): Promise<string[]> {
    const rows = await this.prisma.post.findMany({
      where: { published: true, deletedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    });
    return rows.map((r: any) => r.category).filter(Boolean);
  }

  async tags(): Promise<string[]> {
    const rows = await this.prisma.post.findMany({ where: { published: true, deletedAt: null }, select: { tags: true } });
    const tagSet = new Set<string>();
    for (const row of rows) {
      if (row.tags) {
        row.tags.split(",").map((t: string) => t.trim()).filter(Boolean).forEach((t: string) => tagSet.add(t));
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  async getById(id: string): Promise<PostEntity> {
    const raw = await this.delegate.findUnique({ where: { id, deletedAt: null } });
    if (!raw) throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
    return this.formatEntity(raw);
  }

  private getTrashDir(): string {
    return path.join(this.getContentDir(), ".trash");
  }

  private moveFileToTrash(slug: string): void {
    const dir = this.getContentDir();
    const trashDir = this.getTrashDir();
    const src = path.join(dir, `${slug}${this.fileExtension}`);
    const dest = path.join(trashDir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
      fs.renameSync(src, dest);
    }
  }

  private moveFileFromTrash(slug: string): void {
    const dir = this.getContentDir();
    const trashDir = this.getTrashDir();
    const src = path.join(trashDir, `${slug}${this.fileExtension}`);
    const dest = path.join(dir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(src, dest);
    }
  }

  private deleteFileFromTrash(slug: string): void {
    const trashDir = this.getTrashDir();
    const filePath = path.join(trashDir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      if (existing.deletedAt) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      const slug = this.getExistingFileSlug(existing);
      if (slug) this.moveFileToTrash(slug);
      const raw = await this.delegate.update({ where: { id }, data: { deletedAt: new Date() } });
      return success({
        data: this.buildDeleteSummary(existing),
        state: await this.getState(),
        nextSteps: this.getDeleteNextSteps(),
        operation: "delete",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "delete", this.entityName, `${this.entityName.toUpperCase()}_DELETE_FAILED`);
    }
  }

  async restore(id: string): Promise<OperationResult<PostEntity>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing || !existing.deletedAt) {
        return failure({
          code: "POST_NOT_FOUND",
          message: "恢复文章失败：文章不在回收站中。",
          details: { id },
          retryable: false,
          operation: "restore",
          entity: this.entityName,
        });
      }
      const slug = this.getExistingFileSlug(existing);
      if (slug) this.moveFileFromTrash(slug);
      const raw = await this.delegate.update({ where: { id }, data: { deletedAt: null } });
      const entity = this.formatEntity(raw);
      return success({
        data: entity,
        state: await this.getState(),
        operation: "restore",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "restore", this.entityName, "POST_RESTORE_FAILED");
    }
  }

  async permanentDelete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing || !existing.deletedAt) {
        return failure({
          code: "POST_NOT_FOUND",
          message: "永久删除失败：文章不在回收站中。",
          details: { id },
          retryable: false,
          operation: "permanentDelete",
          entity: this.entityName,
        });
      }
      const slug = this.getExistingFileSlug(existing);
      if (slug) this.deleteFileFromTrash(slug);
      await this.delegate.delete({ where: { id } });
      return success({
        data: this.buildDeleteSummary(existing),
        state: await this.getState(),
        operation: "permanentDelete",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "permanentDelete", this.entityName, "POST_PERMANENT_DELETE_FAILED");
    }
  }

  async listDeleted(page = 1, pageSize = 20): Promise<PaginatedResult<PostEntity>> {
    const where = { deletedAt: { not: null } };
    const skip = (page - 1) * pageSize;
    const [rawItems, total] = await Promise.all([
      this.delegate.findMany({ where, skip, take: pageSize, orderBy: { deletedAt: "desc" } }),
      this.delegate.count({ where }),
    ]);
    return {
      items: rawItems.map((item: any) => this.formatEntity(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private generateSlug(title: string): string {
    return title.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 80).concat("-", Date.now().toString(36));
  }
}

/** Agent 智能体 */
export interface AgentEntity {
  id: string;
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  tools: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class AgentService extends FileSyncService<CreateAgentInput, UpdateAgentInput, ListAgentsInput, AgentEntity> {
  readonly entityName = "agent";
  readonly contentDirName = "agents";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.agent; }

  protected formatEntity(raw: any): AgentEntity {
    return {
      ...raw,
      tools: raw.tools ? raw.tools.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  protected buildListWhere(input: ListAgentsInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateAgentInput): any {
    const tools = materializeAgentTools(input.tools);
    return {
      name: input.name,
      description: input.description,
      model: input.model,
      systemPrompt: input.systemPrompt,
      tools: tools.join(","),
    };
  }

  protected buildUpdateData(input: UpdateAgentInput): any {
    const { id: _id, tools, name, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name;
    if (tools !== undefined) updateData.tools = materializeAgentTools(tools).join(",");
    return updateData;
  }

  protected serializeToFile(entity: AgentEntity): string {
    const toolsYaml = entity.tools.length > 0 ? `\ntools:\n` + entity.tools.map((t) => `  - "${t}"`).join("\n") : "\ntools: []";
    return `---
name: "${entity.name.replace(/"/g, '\\"')}"
description: ${entity.description ? `"${entity.description.replace(/"/g, '\\"')}"` : "null"}
model: "${entity.model}"${toolsYaml}
---
${entity.systemPrompt}
`;
  }

  protected getFileSlug(entity: AgentEntity): string { return entity.name; }

  protected override async validateCreate(input: CreateAgentInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }

  protected override async validateUpdate(input: UpdateAgentInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name };
  }
}

/** Skill 技能 */
export interface SkillEntity {
  id: string;
  name: string;
  description: string;
  code: string;
  icon: string | null;
  trigger: string | null;
  enabled: boolean;
  metaJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SkillService extends FileSyncService<CreateSkillInput, UpdateSkillInput, ListSkillsInput, SkillEntity> {
  readonly entityName = "skill";
  readonly contentDirName = "skills";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.skill; }
  protected formatEntity(raw: any): SkillEntity { return raw; }

  protected buildListWhere(input: ListSkillsInput): any {
    const where: any = {};
    if (input.enabled !== undefined) where.enabled = input.enabled;
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateSkillInput): any { return input; }
  protected buildUpdateData(input: UpdateSkillInput): any {
    const { id: _id, ...data } = input;
    return data;
  }

  protected serializeToFile(entity: SkillEntity): string {
    let meta: Record<string, unknown> = {};
    if (entity.metaJson) {
      try {
        meta = JSON.parse(entity.metaJson);
      } catch {
        meta = {};
      }
    }
    const lines = [
      `name: "${entity.name.replace(/"/g, '\\"')}"`,
      `description: "${entity.description.replace(/"/g, '\\"')}"`,
      `icon: ${entity.icon ? `"${entity.icon}"` : "null"}`,
      `trigger: ${entity.trigger ? `"${entity.trigger}"` : "null"}`,
      `enabled: ${entity.enabled}`,
    ];
    if (meta.model) lines.push(`model: "${meta.model}"`);
    if (meta.context) lines.push(`context: ${meta.context}`);
    if (meta.kind) lines.push(`kind: ${meta.kind}`);
    if (Array.isArray(meta.allowedTools) && meta.allowedTools.length) {
      lines.push(`allowed-tools:\n${(meta.allowedTools as string[]).map((t) => `  - ${t}`).join("\n")}`);
    }
    return `---\n${lines.join("\n")}\n---\n${entity.code}\n`;
  }

  protected getFileSlug(entity: SkillEntity): string { return entity.name; }

  protected override async validateCreate(input: CreateSkillInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }

  protected override async validateUpdate(input: UpdateSkillInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name };
  }
}

/** McpServer MCP 数据源服务器 */
export interface McpServerEntity {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class McpService extends FileSyncService<CreateMcpServerInput, UpdateMcpServerInput, ListMcpServersInput, McpServerEntity> {
  readonly entityName = "mcp";
  readonly contentDirName = "mcp";
  readonly fileExtension = ".json";

  protected get delegate() { return this.prisma.mcpServer; }

  protected formatEntity(raw: any): McpServerEntity {
    return {
      ...raw,
      args: typeof raw.args === "string" ? JSON.parse(raw.args) : (raw.args || []),
      env: typeof raw.env === "string" ? JSON.parse(raw.env) : (raw.env || {}),
    };
  }

  protected buildListWhere(input: ListMcpServersInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { command: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateMcpServerInput): any {
    return {
      name: input.name,
      command: input.command,
      args: JSON.stringify(input.args),
      env: JSON.stringify(input.env),
      enabled: input.enabled,
    };
  }

  protected buildUpdateData(input: UpdateMcpServerInput): any {
    const { id: _id, args, env, ...data } = input;
    const updateData: any = { ...data };
    if (args !== undefined) updateData.args = JSON.stringify(args);
    if (env !== undefined) updateData.env = JSON.stringify(env);
    return updateData;
  }

  protected serializeToFile(entity: McpServerEntity): string {
    return JSON.stringify({ name: entity.name, command: entity.command, args: entity.args, env: entity.env, enabled: entity.enabled }, null, 2) + "\n";
  }

  protected getFileSlug(entity: McpServerEntity): string { return entity.name; }

  protected override async validateCreate(input: CreateMcpServerInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }

  protected override async validateUpdate(input: UpdateMcpServerInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name };
  }
}

/** Memory 长期语义记忆 */
export interface MemoryEntity {
  id: string;
  content: string;
  type: string;
  strength: number;
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryService extends FileSyncService<CreateMemoryInput, UpdateMemoryInput, ListMemoriesInput, MemoryEntity> {
  readonly entityName = "memory";
  readonly contentDirName = "memories";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.memory; }

  protected formatEntity(raw: any): MemoryEntity {
    return {
      ...raw,
      keywords: raw.keywords ? raw.keywords.split(",").filter(Boolean).map((k: string) => k.trim()) : [],
    };
  }

  protected buildListWhere(input: ListMemoriesInput): any {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.keyword) {
      where.OR = [{ content: { contains: input.keyword } }, { keywords: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateMemoryInput): any {
    return {
      content: input.content,
      type: input.type,
      strength: input.strength,
      keywords: input.keywords.join(","),
    };
  }

  protected buildUpdateData(input: UpdateMemoryInput): any {
    const { id: _id, keywords, ...data } = input;
    const updateData: any = { ...data };
    if (keywords !== undefined) updateData.keywords = keywords.join(",");
    return updateData;
  }

  protected serializeToFile(entity: MemoryEntity): string {
    const frontmatter = dump(
      {
        content: entity.content,
        type: entity.type,
        strength: entity.strength,
        keywords: entity.keywords,
      },
      { lineWidth: -1, noRefs: true },
    );
    return `---\n${frontmatter}---\n\n${entity.content}\n`;
  }

  protected getFileSlug(entity: MemoryEntity): string { return entity.id; }
}

/** ChatSession 聊天会话 */
export interface SessionEntity {
  id: string;
  title: string;
  model: string;
  systemPrompt: string | null;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionService extends BaseService<CreateSessionInput, UpdateSessionInput, ListSessionsInput, SessionEntity> {
  readonly entityName = "session";
  protected get delegate() { return this.prisma.chatSession; }
  protected formatEntity(raw: any): SessionEntity { return raw; }

  protected buildListWhere(input: ListSessionsInput): any {
    const where: any = {};
    if (input.keyword) where.title = { contains: input.keyword };
    return where;
  }

  protected buildCreateData(input: CreateSessionInput): any { return input; }
  protected buildUpdateData(input: UpdateSessionInput): any {
    const { id: _id, ...data } = input;
    return data;
  }

  override async getById(id: string): Promise<any> {
    const session = await this.prisma.chatSession.findUnique({ where: { id }, include: { messages: true } });
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return session;
  }

  async deleteMany(_input?: Record<string, never>): Promise<{ count: number }> {
    const result = await this.prisma.chatSession.deleteMany({});
    return { count: result.count };
  }

  protected override getCreateNextSteps(entity: SessionEntity): NextStep[] {
    return [{ action: "进入会话发送消息", procedure: "message.create", input: { sessionId: entity.id }, reason: "新会话已创建，可开始对话。" }];
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, title: existing.title };
  }
}

/** ChatMessage 聊天消息 */
export interface MessageEntity {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  attachments: any;
  toolCalls: any;
  toolResults: any;
  tokenUsage: any;
  createdAt: Date;
}

export class MessageService extends BaseService<CreateMessageInput, UpdateMessageInput, ListMessagesInput, MessageEntity> {
  readonly entityName = "message";
  protected get delegate() { return this.prisma.chatMessage; }
  protected formatEntity(raw: any): MessageEntity { return raw; }
  protected buildListWhere(input: ListMessagesInput): any { return { sessionId: input.sessionId }; }
  protected buildCreateData(input: CreateMessageInput): any { return input; }
  protected buildUpdateData(input: UpdateMessageInput): any {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override get defaultOrderBy(): string { return "createdAt"; }
  protected override get defaultOrder(): "asc" | "desc" { return "asc"; }
}

/** File 资源元数据 (带 Base64 上传) */
export class FileService extends BaseService<CreateFileInput, UpdateFileInput, ListFilesInput, any> {
  readonly entityName = "file";
  protected get delegate() { return this.prisma.file; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListFilesInput) {
    const where: any = {};
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }
  protected buildCreateData(input: CreateFileInput) { return input; }
  protected buildUpdateData(input: UpdateFileInput) { const { id: _id, ...data } = input; return data; }

  async upload(input: { name: string; mimeType: string; size: number; data: string }): Promise<OperationResult<any>> {
    const start = Date.now();
    try {
      const { name, mimeType, size, data } = input;
      const safeName = path.basename(name);
      const ext = path.extname(safeName);
      const baseName = path.basename(safeName, ext);
      const uniqueName = `${baseName}_${Date.now().toString(36)}${ext}`;
      const uploadDir = this.config.uploadDir;
      const filePath = path.join(uploadDir, uniqueName);
      const buffer = Buffer.from(data, "base64");
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/uploads/${uniqueName}`;
      const fileRecord = await this.prisma.file.create({
        data: { name: safeName, path: filePath, mimeType, size, url: fileUrl },
      });
      this.eventBus.emit("file.created", fileRecord);
      return success({ data: fileRecord, operation: "upload", entity: "file", durationMs: Date.now() - start });
    } catch (error: any) {
      return failureFromError(error, "upload", "file", "FILE_UPLOAD_FAILED");
    }
  }
}

/** Log 系统日志 */
export class LogService extends BaseService<CreateLogInput, UpdateLogInput, ListLogsInput, any> {
  readonly entityName = "log";
  protected get delegate() { return this.prisma.log; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListLogsInput) {
    const where: any = {};
    if (input.level) where.level = input.level;
    if (input.component) where.component = input.component;
    if (input.keyword) {
      where.OR = [{ message: { contains: input.keyword } }, { event: { contains: input.keyword } }];
    }
    return where;
  }
  protected buildCreateData(input: CreateLogInput) { return input; }
  protected buildUpdateData(input: UpdateLogInput) { const { id: _id, ...data } = input; return data; }

  async clearAll(): Promise<number> {
    const { count } = await this.prisma.log.deleteMany();
    return count;
  }
}

/** GitRepo Git仓库 */
export class GitService extends BaseService<CreateGitRepoInput, UpdateGitRepoInput, ListGitReposInput, any> {
  readonly entityName = "git";
  protected get delegate() { return this.prisma.gitRepo; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(_input: ListGitReposInput) { return {}; }
  protected buildCreateData(input: CreateGitRepoInput) { return input; }
  protected buildUpdateData(input: UpdateGitRepoInput) { const { id: _id, ...data } = input; return data; }

  protected override async validateCreate(input: CreateGitRepoInput): Promise<void> {
    await this.assertUnique("path", input.path, "创建");
    // 安全：注册阶段即校验 path 在 projectRoot 之内，堵住后续 git commit/push 对任意磁盘路径的操作
    resolveSafePath(this.config, input.path);
  }
  protected override async validateUpdate(input: UpdateGitRepoInput, _existing: any): Promise<void> {
    if (input.path) resolveSafePath(this.config, input.path);
  }
  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name, path: existing.path };
  }

  private async resolveRepoPath(input: GitRepoPathInput): Promise<string> {
    // 安全：所有 Git 操作的 cwd 都必须经 resolveSafePath / assertPathWithinProjectRoot 校验
    if (input.repoPath) return resolveSafePath(this.config, input.repoPath);
    if (input.repoId) {
      const repo = await this.getById(input.repoId);
      assertPathWithinProjectRoot(this.config, repo.path);
      return repo.path;
    }
    return this.config.projectRoot;
  }

  private async runGit(cwd: string, args: string[]): Promise<string> {
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return (stdout || stderr || "").trim();
  }

  async status(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, status: await this.runGit(cwd, ["status", "--porcelain", "-b"]) };
  }

  async log(input: GitRepoPathInput & { limit?: number }) {
    const cwd = await this.resolveRepoPath(input);
    const limit = String(input.limit || 10);
    const output = await this.runGit(cwd, ["log", `--max-count=${limit}`, "--oneline", "--decorate"]);
    return { path: cwd, log: output.split("\n").filter(Boolean) };
  }

  async diff(input: GitRepoPathInput & { staged?: boolean }) {
    const cwd = await this.resolveRepoPath(input);
    const args = input.staged ? ["diff", "--cached"] : ["diff"];
    return { path: cwd, diff: (await this.runGit(cwd, args)).slice(0, 12000) };
  }

  async commit(input: GitRepoPathInput & { message: string }) {
    const cwd = await this.resolveRepoPath(input);
    await this.runGit(cwd, ["add", "-A"]);
    const output = await this.runGit(cwd, ["commit", "-m", input.message]);
    return { path: cwd, output };
  }

  async pull(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, output: await this.runGit(cwd, ["pull"]) };
  }

  async push(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, output: await this.runGit(cwd, ["push"]) };
  }
}

/** Task 后台任务 */
export class TaskService extends BaseService<CreateTaskInput, UpdateTaskInput, ListTasksInput, any> {
  readonly entityName = "task";
  protected get delegate() { return this.prisma.task; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListTasksInput) {
    const where: any = {};
    if (input.status) where.status = input.status;
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }
  protected buildCreateData(input: CreateTaskInput) { return input; }
  protected buildUpdateData(input: UpdateTaskInput) { const { id: _id, ...data } = input; return data; }

  /** 立即执行任务（db:sync 等） */
  async run(id: string): Promise<OperationResult<any>> {
    let task: { id: string; name: string; type: string; input?: unknown };
    try {
      task = (await this.getById(id)) as { id: string; name: string; type: string; input?: unknown };
    } catch {
      return failure({
        code: "TASK_NOT_FOUND",
        message: `执行任务失败：id 为 "${id}" 的任务不存在。`,
        details: { id },
        field: "id",
        retryable: false,
        operation: "run",
        entity: this.entityName,
        durationMs: 0,
      });
    }

    await this.update({ id, status: "running" });

    try {
      const { executeTaskJob } = await import("./infra/taskRunner.js");
      const output = await executeTaskJob(this.prisma, task);
      return this.update({ id, status: "success", output });
    } catch (err: unknown) {
      return this.update({
        id,
        status: "failed",
        output: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

/** Workspace 工作区 */
export class WorkspaceService extends BaseService<CreateWorkspaceInput, UpdateWorkspaceInput, ListWorkspacesInput, any> {
  readonly entityName = "workspace";
  protected get delegate() { return this.prisma.workspace; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListWorkspacesInput) {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }
  protected buildCreateData(input: CreateWorkspaceInput) { return input; }
  protected buildUpdateData(input: UpdateWorkspaceInput) { const { id: _id, ...data } = input; return data; }

  protected override async validateCreate(input: CreateWorkspaceInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
    await this.assertUnique("path", input.path, "创建");
  }
  protected override async validateUpdate(input: UpdateWorkspaceInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
    if (input.path && input.path !== existing.path) await this.assertUnique("path", input.path, "更新", input.id);
  }
}

/** Trigger 触发器 */
export class TriggerService extends BaseService<CreateTriggerInput, UpdateTriggerInput, ListTriggersInput, any> {
  readonly entityName = "trigger";
  protected get delegate() { return this.prisma.trigger; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListTriggersInput) {
    const where: any = {};
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }
  protected buildCreateData(input: CreateTriggerInput) { return input; }
  protected buildUpdateData(input: UpdateTriggerInput) { const { id: _id, ...data } = input; return data; }

  protected override async validateCreate(input: CreateTriggerInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateTriggerInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
  }
}

/** Approval 审批队列 */
export class ApprovalService extends BaseService<CreateApprovalInput, UpdateApprovalInput, ListApprovalsInput, any> {
  readonly entityName = "approval";
  protected get delegate() { return this.prisma.approval; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListApprovalsInput) {
    const where: any = {};
    if (input.status) where.status = input.status;
    return where;
  }
  protected buildCreateData(input: CreateApprovalInput) { return input; }
  protected buildUpdateData(input: UpdateApprovalInput) { const { id: _id, ...data } = input; return data; }
}

/** Tool 工具注册表 */
export class ToolService extends BaseService<CreateToolInput, UpdateToolInput, ListToolsInput, any> {
  readonly entityName = "tool";
  protected get delegate() { return this.prisma.tool; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListToolsInput) {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.enabled !== undefined) where.enabled = input.enabled;
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }
  protected buildCreateData(input: CreateToolInput) { return input; }
  protected buildUpdateData(input: UpdateToolInput) { const { id: _id, ...data } = input; return data; }

  protected override async validateCreate(input: CreateToolInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateToolInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
  }
}

/** Run 执行记录 */
export class RunService extends BaseService<CreateRunInput, UpdateRunInput, ListRunsInput, any> {
  readonly entityName = "run";
  protected get delegate() { return this.prisma.run; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListRunsInput) {
    const where: any = {};
    if (input.agentId) where.agentId = input.agentId;
    if (input.sessionId) where.sessionId = input.sessionId;
    if (input.status) where.status = input.status;
    return where;
  }
  protected buildCreateData(input: CreateRunInput) { return input; }
  protected buildUpdateData(input: UpdateRunInput) { const { id: _id, ...data } = input; return data; }
}

/** Prompt 提示词模板 (文件同步) */
export class PromptService extends FileSyncService<CreatePromptInput, UpdatePromptInput, ListPromptsInput, any> {
  readonly entityName = "prompt";
  readonly contentDirName = "prompts";
  readonly fileExtension = ".md";
  protected get delegate() { return this.prisma.prompt; }

  protected formatEntity(raw: any) {
    return {
      ...raw,
      variables: raw.variables ? raw.variables.split(",").filter(Boolean).map((v: string) => v.trim()) : [],
      tags: raw.tags ? raw.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  protected buildListWhere(input: ListPromptsInput) {
    const where: any = {};
    if (input.tag) where.tags = { contains: input.tag };
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreatePromptInput) {
    return { name: input.name, version: input.version, description: input.description, variables: input.variables.join(","), tags: input.tags.join(","), content: input.content };
  }

  protected buildUpdateData(input: UpdatePromptInput) {
    const { id: _id, variables, tags, ...data } = input;
    const updateData: any = { ...data };
    if (variables !== undefined) updateData.variables = variables.join(",");
    if (tags !== undefined) updateData.tags = tags.join(",");
    return updateData;
  }

  protected serializeToFile(entity: any): string {
    const varsYaml = entity.variables?.length > 0 ? `\nvariables:\n` + entity.variables.map((v: string) => `  - "${v}"`).join("\n") : "\nvariables: []";
    const tagsYaml = entity.tags?.length > 0 ? `\ntags:\n` + entity.tags.map((t: string) => `  - "${t}"`).join("\n") : "\ntags: []";
    return `---
name: "${entity.name}"
version: "${entity.version}"
description: ${entity.description ? `"${entity.description}"` : "null"}${varsYaml}${tagsYaml}
---
${entity.content}
`;
  }

  protected getFileSlug(entity: any): string { return entity.name; }

  protected override async validateCreate(input: CreatePromptInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdatePromptInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
  }
}

/** Credential 凭据管理 */
export class CredentialService extends BaseService<CreateCredentialInput, UpdateCredentialInput, ListCredentialsInput, any> {
  readonly entityName = "credential";
  protected get delegate() { return this.prisma.credential; }

  protected formatEntity(raw: any) {
    // 安全：API 响应永不返回明文 value，仅返回遮蔽后的 valuePreview。
    // 明文仅在 credentialVault 内部（getCredentialValue 等）解密使用。
    const { value: _encryptedValue, ...rest } = raw;
    return {
      ...rest,
      valuePreview: maskSecret(decryptCredentialValue(raw.value)),
      scope: raw.scope ? raw.scope.split(",").filter(Boolean).map((s: string) => s.trim()) : [],
      metadata: raw.metadata ? safeJsonParse(raw.metadata) : null,
    };
  }

  protected buildListWhere(input: ListCredentialsInput) {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }

  protected buildCreateData(input: CreateCredentialInput) {
    return {
      name: input.name,
      type: input.type,
      value: encryptCredentialValue(input.value),
      scope: input.scope.join(","),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    };
  }

  protected buildUpdateData(input: UpdateCredentialInput) {
    const { id: _id, scope, expiresAt, metadata, value, ...data } = input;
    const updateData: any = { ...data };
    if (value !== undefined) updateData.value = encryptCredentialValue(value);
    if (scope !== undefined) updateData.scope = scope.join(",");
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (metadata !== undefined) updateData.metadata = metadata ? JSON.stringify(metadata) : null;
    return updateData;
  }

  protected override async validateCreate(input: CreateCredentialInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateCredentialInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
  }
}

/** InfoSource 信息源 — Agent 可信信息来源 */
export interface InfoSourceEntity {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string;
  reliability: number;
  language: string;
  tags: string[];
  enabled: boolean;
  sourceSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InfoSourceService extends FileSyncService<
  CreateInfoSourceInput,
  UpdateInfoSourceInput,
  ListInfoSourcesInput,
  InfoSourceEntity
> {
  readonly entityName = "infoSource";
  readonly contentDirName = "sources";
  readonly fileExtension = ".json";

  protected get delegate() { return this.prisma.infoSource; }

  protected formatEntity(raw: any): InfoSourceEntity {
    return {
      ...raw,
      tags: raw.tags ? raw.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  protected buildListWhere(input: ListInfoSourcesInput): any {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.enabled !== undefined) where.enabled = input.enabled;
    if (input.minReliability !== undefined) where.reliability = { gte: input.minReliability };
    if (input.tag) where.tags = { contains: input.tag };
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { url: { contains: input.keyword } },
        { description: { contains: input.keyword } },
        { tags: { contains: input.keyword } },
      ];
    }
    return where;
  }

  private slugifyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `source-${Date.now().toString(36)}`;
  }

  protected buildCreateData(input: CreateInfoSourceInput): any {
    const slug = this.slugifyName(input.name);
    return {
      name: input.name.trim(),
      url: input.url.trim(),
      type: input.type,
      description: input.description ?? "",
      reliability: input.reliability,
      language: input.language,
      tags: input.tags?.join(",") || "",
      enabled: input.enabled ?? true,
      sourceSlug: slug,
    };
  }

  protected buildUpdateData(input: UpdateInfoSourceInput): any {
    const { id: _id, tags, name, url, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name.trim();
    if (url !== undefined) updateData.url = url.trim();
    if (tags !== undefined) updateData.tags = tags.join(",");
    return updateData;
  }

  protected serializeToFile(entity: InfoSourceEntity): string {
    return `${JSON.stringify(
      {
        name: entity.name,
        url: entity.url,
        type: entity.type,
        description: entity.description,
        reliability: entity.reliability,
        language: entity.language,
        tags: entity.tags,
        enabled: entity.enabled,
      },
      null,
      2,
    )}\n`;
  }

  protected getFileSlug(entity: InfoSourceEntity): string {
    return entity.sourceSlug || this.slugifyName(entity.name);
  }

  protected override async validateCreate(input: CreateInfoSourceInput): Promise<void> {
    await this.assertUnique("name", input.name.trim(), "创建");
  }

  protected override async validateUpdate(input: UpdateInfoSourceInput, existing: any): Promise<void> {
    if (input.name && input.name.trim() !== existing.name) {
      await this.assertUnique("name", input.name.trim(), "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name, url: existing.url };
  }
}
