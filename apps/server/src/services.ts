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
import { randomBytes } from "node:crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { dump } from "js-yaml";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
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
  type CreateSessionQueueItemInput,
  type UpdateSessionQueueItemInput,
  type ListSessionQueueItemsInput,
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
// type-only：编译期擦除，不构成运行时循环依赖（resume 的 runner emit 追踪用）
import type { AgentStreamEvent } from "./infra/agentStream.js";
import { notifyApprovalResolved } from "./infra/approvalGate.js";
import { encryptCredentialValue, decryptCredentialValue, maskSecret, invalidateIntegrationCredentials } from "./infra/credentialVault.js";
import { upsertFtsRow, deleteFtsRow, searchFts } from "./infra/ftsIndex.js";
import { invalidateCapabilitiesCache } from "./infra/capabilities.js";
import { resolveSafePath, assertPathWithinProjectRoot } from "./infra/safePath.js";
import { parseSkillKind, skillFileSlug } from "./infra/skillPackage.js";

/* ─── 1. 辅助类型与基类 ─── */

/** 预生成与 Prisma @default(cuid()) / z.string().cuid() 兼容的 id（文件先行写路径需要） */
function newEntityId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

/** 安全 JSON.parse：失败时返回 null 并 warn，避免坏数据致 list 整体崩溃。 */
function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** P1-11：检测 Prisma 唯一约束冲突（P2002），返回友好的 CONFLICT failure；非 P2002 返回 null。 */
function failureFromPrismaUnique(error: unknown, operation: string, entityName: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = (error.meta?.target as string[] | undefined)?.join(", ") ?? "字段";
    return failure({
      code: `${entityName.toUpperCase()}_CONFLICT`,
      message: `${operation} ${entityName} 失败：${target} 已被其他记录占用（并发冲突）。`,
      details: { target: error.meta?.target },
      field: target,
      suggestion: `请使用不同的 ${target}，或稍后重试。`,
      retryable: false,
      operation,
      entity: entityName,
    });
  }
  return null;
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
      // P1-11：并发 create 同名触发 P2002 时转友好 CONFLICT，而非通用 CREATE_FAILED
      const uniqueConflict = failureFromPrismaUnique(error, "创建", this.entityName);
      if (uniqueConflict) return uniqueConflict;
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
      const uniqueConflict = failureFromPrismaUnique(error, "更新", this.entityName);
      if (uniqueConflict) return uniqueConflict;
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
 *
 * 不变量（D1）：文件先成为事实，DB 后投影；文件操作失败则 DB 不动。
 * create：写文件 → DB create（失败则补偿删文件）
 * update：写新文件 → DB update → 成功后删旧文件（改名时）
 * delete：删文件 → DB delete（文件删不掉则报错、不删 DB）
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

  /**
   * D3：slug 消毒 + 最终路径必须落在对应 content 子目录内（兼 projectRoot）。
   * 允许受控嵌套（如 skill `name/SKILL`），禁止 `..` / 绝对路径 / Windows 保留字符。
   */
  protected assertSafeFileSlug(slug: string): string {
    if (!slug || typeof slug !== "string") {
      throw new Error(`${this.entityName} 文件 slug 不能为空`);
    }
    if (/[\\<>:"|?*\x00-\x1f]/.test(slug) || slug.includes("..")) {
      throw new Error(`${this.entityName} 非法文件 slug（含保留字符或 ..）：${slug}`);
    }
    if (slug.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(slug)) {
      throw new Error(`${this.entityName} 非法文件 slug（绝对路径）：${slug}`);
    }
    const parts = slug.replace(/\\/g, "/").split("/");
    if (parts.some((p) => !p || p === "." || p === "..")) {
      throw new Error(`${this.entityName} 非法文件 slug（空段或 . / ..）：${slug}`);
    }
    return slug;
  }

  protected resolveEntityFilePath(slug: string): string {
    const safe = this.assertSafeFileSlug(slug);
    const filePath = path.resolve(this.getContentDir(), `${safe}${this.fileExtension}`);
    assertPathWithinProjectRoot(this.config, filePath);
    const contentRoot = path.resolve(this.getContentDir());
    const prefix = contentRoot.endsWith(path.sep) ? contentRoot : contentRoot + path.sep;
    if (filePath !== contentRoot && !filePath.startsWith(prefix)) {
      throw new Error(`${this.entityName} 文件路径越出 content/${this.contentDirName}：${slug}`);
    }
    return filePath;
  }

  protected writeFile(entity: TEntity): void {
    const filePath = this.resolveEntityFilePath(this.getFileSlug(entity));
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, this.serializeToFile(entity), "utf-8");
  }

  protected deleteFile(entity: TEntity): void {
    const slug = this.getFileSlug(entity);
    this.deleteFileBySlug(slug, { required: true });
  }

  /**
   * 按 slug 删除实体文件。
   * required=true（默认）：文件存在但删失败 → 抛错（delete 路径依赖此语义）。
   * required=false：失败仅 warn（update 改名后清旧文件：不回滚）。
   */
  protected deleteFileBySlug(slug: string, opts?: { required?: boolean }): boolean {
    const required = opts?.required !== false;
    let filePath: string;
    try {
      filePath = this.resolveEntityFilePath(slug);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (required) throw e;
      console.warn(`[FileSync] 跳过非法 slug 删除 entity=${this.entityName}:`, msg);
      return false;
    }
    if (!fs.existsSync(filePath)) return true;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (required) {
        throw new Error(`删除 ${this.entityName} 文件失败（${filePath}）：${msg}`);
      }
      console.warn(`[FileSync] 删除旧文件失败 entity=${this.entityName} slug=${slug}:`, msg);
      return false;
    }
  }

  /** 为文件先行路径拼出可 formatEntity 的临时行（含预生成 id） */
  protected buildProvisionalRaw(data: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
    const now = new Date();
    return {
      ...(existing ?? {}),
      ...data,
      id: data.id ?? existing?.id ?? newEntityId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  override async create(input: TCreate): Promise<OperationResult<TEntity>> {
    const start = Date.now();
    let writtenSlug: string | null = null;
    try {
      await this.validateCreate(input);
      const data = this.buildCreateData(input);
      if (!data.id) data.id = newEntityId();
      const provisional = this.formatEntity(this.buildProvisionalRaw(data));
      this.writeFile(provisional);
      writtenSlug = this.getFileSlug(provisional);
      try {
        const raw = await this.delegate.create({ data });
        const entity = this.formatEntity(raw);
        await this.syncFileMetaToDb(entity);
        await this.afterCreate(entity, input);
        return success({
          data: entity,
          state: await this.getState(),
          nextSteps: this.getCreateNextSteps(entity),
          operation: "create",
          entity: this.entityName,
          durationMs: Date.now() - start,
        });
      } catch (dbError) {
        if (writtenSlug) {
          try {
            this.deleteFileBySlug(writtenSlug, { required: false });
          } catch {
            /* compensate best-effort */
          }
        }
        throw dbError;
      }
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      const uniqueConflict = failureFromPrismaUnique(error, "创建", this.entityName);
      if (uniqueConflict) return uniqueConflict;
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  override async update(input: TUpdate): Promise<OperationResult<TEntity>> {
    const start = Date.now();
    const { id } = input;
    let wroteNewSlug: string | null = null;
    let oldSlug: string | null = null;
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("更新", id, Date.now() - start);
      await this.validateUpdate(input, existing);
      const updateData = this.buildUpdateData(input);
      const provisional = this.formatEntity(this.buildProvisionalRaw(updateData, existing));
      oldSlug = this.getExistingFileSlug(existing);
      const newSlug = this.getFileSlug(provisional);
      this.writeFile(provisional);
      wroteNewSlug = newSlug;
      try {
        const raw = await this.delegate.update({ where: { id }, data: updateData });
        const entity = this.formatEntity(raw);
        await this.syncFileMetaToDb(entity);
        if (oldSlug && oldSlug !== newSlug) {
          this.deleteFileBySlug(oldSlug, { required: false });
        }
        await this.afterUpdate(entity, existing, input);
        return success({
          data: entity,
          state: await this.getState(),
          operation: "update",
          entity: this.entityName,
          durationMs: Date.now() - start,
        });
      } catch (dbError) {
        // DB 失败：若已写出新 slug 文件则补偿删除；同 slug 覆盖写不回滚（文件即事实源）
        if (wroteNewSlug && oldSlug && wroteNewSlug !== oldSlug) {
          this.deleteFileBySlug(wroteNewSlug, { required: false });
        }
        throw dbError;
      }
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      const uniqueConflict = failureFromPrismaUnique(error, "更新", this.entityName);
      if (uniqueConflict) return uniqueConflict;
      return failureFromError(error, "update", this.entityName, `${this.entityName.toUpperCase()}_UPDATE_FAILED`);
    }
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      const slug = this.getExistingFileSlug(existing);
      if (slug) this.deleteFileBySlug(slug, { required: true });
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

  /**
   * 写文件后把 sourceSlug/sourceMtime 回写到 DB，让 db:sync 能按 sourceSlug 匹配到记录。
   * Post 无 sourceSlug 列（用 slug 主键），只回写 sourceMtime。
   */
  protected async syncFileMetaToDb(entity: TEntity): Promise<void> {
    const id = (entity as any).id;
    if (!id) return;
    try {
      const slug = this.getFileSlug(entity);
      const filePath = this.resolveEntityFilePath(slug);
      const mtime = fs.existsSync(filePath) ? fs.statSync(filePath).mtime : new Date();
      if (this.entityName === "post") {
        await this.delegate.update({ where: { id }, data: { sourceMtime: mtime } });
        return;
      }
      await this.delegate.update({ where: { id }, data: { sourceSlug: slug, sourceMtime: mtime } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[FileSync] syncFileMetaToDb 失败 entity=${this.entityName} id=${id}:`, msg);
    }
  }

  /* ─── P11：FTS 增量维护辅助（best-effort，失败不阻塞业务） ─── */
  protected async syncFts(entityName: string, entityId: string, title: string, body: string): Promise<void> {
    try {
      await upsertFtsRow(this.prisma, entityName, entityId, title, body);
    } catch (e) {
      console.warn(`[FTS] upsert ${entityName}:${entityId} 失败:`, e instanceof Error ? e.message : e);
    }
  }
  protected async removeFts(entityName: string, entityId: string): Promise<void> {
    try {
      await deleteFtsRow(this.prisma, entityName, entityId);
    } catch (e) {
      console.warn(`[FTS] delete ${entityName}:${entityId} 失败:`, e instanceof Error ? e.message : e);
    }
  }

  protected getExistingFileSlug(existing: any): string | null {
    try { return this.getFileSlug(this.formatEntity(existing)); } catch { return null; }
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

  // R13：keyword 优先走 FTS 取 post id 再过滤，避免 LIKE 扫 title+content 全表；FTS 无命中/不可用回退 LIKE
  async list(input: ListPostsInput): Promise<PaginatedResult<PostEntity>> {
    if (input.keyword && !(input as any).ftsIds) {
      try {
        const hits = await searchFts(this.prisma, input.keyword, 200);
        const ids = hits.filter((h) => h.entity === "post").map((h) => h.entityId);
        if (ids.length > 0) {
          return super.list({ ...input, ftsIds: ids } as any);
        }
      } catch {
        // FTS 不可用，回退 LIKE
      }
    }
    return super.list(input);
  }

  protected buildListWhere(input: ListPostsInput): any {
    const where: any = { deletedAt: null };
    if (input.published !== undefined) where.published = input.published;
    if (input.category) where.category = input.category;
    if (input.tag) where.tags = { contains: input.tag };
    // R13：FTS 命中时按 id 过滤；否则回退 LIKE
    if ((input as any).ftsIds) {
      where.id = { in: (input as any).ftsIds };
    } else if (input.keyword) {
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
    // P1-7：列表不返回完整 content，载荷过大；需要正文走 getById。
    return { id: true, title: true, slug: true, excerpt: true, coverImage: true, published: true, category: true, tags: true, viewCount: true, createdAt: true, updatedAt: true };
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

  // P11：FTS 增量——create/update 后 upsert，delete 后 remove
  protected override async afterCreate(entity: PostEntity, input: CreatePostInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("post", entity.id, entity.title, `${entity.slug}\n${entity.content ?? ""}`);
  }
  protected override async afterUpdate(entity: PostEntity, existing: any, input: UpdatePostInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("post", entity.id, entity.title, `${entity.slug}\n${entity.content ?? ""}`);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("post", existing.id);
  }

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
    // A15：浏览量自增改 fire-and-forget，不阻塞读取关键路径；返回的 post 仍是自增前的快照（与原行为一致）
    void this.prisma.post
      .update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => {
        // 统计写入失败不影响文章读取
      });
    return this.formatEntity(post);
  }

  async search(query: string, limit = 10): Promise<PostEntity[]> {
    // R1：优先 FTS（索引覆盖 title+content，远快于 LIKE %q% 全表扫）。
    // FTS 命中 post id 后按 rank 顺序 findMany 回填，保持 API 形状不变；FTS 无命中/不可用时回退 LIKE。
    try {
      const ftsHits = await searchFts(this.prisma, query, limit * 2);
      const postIds = ftsHits.filter((h) => h.entity === "post").map((h) => h.entityId);
      if (postIds.length > 0) {
        const posts = await this.prisma.post.findMany({
          where: { id: { in: postIds }, deletedAt: null },
        });
        const byId = new Map(posts.map((p: any) => [p.id, p] as const));
        const ordered = postIds.map((id) => byId.get(id)).filter((p): p is any => !!p);
        if (ordered.length > 0) return ordered.slice(0, limit).map((item: any) => this.formatEntity(item));
      }
    } catch {
      // FTS 不可用（表未就绪等），回退 LIKE
    }
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
      // P2-7：软删后显式触发 post.deleted 事件（不调继承的 afterDelete，因其会 deleteFileBySlug，
      // 而此处文件已 moveFileToTrash，避免重复处理）。TriggerEngine 等监听器依赖此事件联动。
      this.eventBus.emit("post.deleted", existing);
      // #11：软删后即时移除 FTS，避免搜索仍命中回收站文章（恢复时再 re-index）
      await this.removeFts("post", existing.id);
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
      // #11：恢复后重新入 FTS，使文章可被搜索
      await this.syncFts("post", entity.id, entity.title, `${entity.slug}\n${entity.content ?? ""}`);
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
      // #11：永久删除后移除 FTS
      await this.removeFts("post", existing.id);
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
  // Swarm 层级
  tier: "super" | "manager" | "sub";
  workspaceId: string | null;
  parentId: string | null;
  apiKey: string | null;
  heartbeatModel: string | null;
  heartbeat: any;
  status: string;
  source: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentService extends FileSyncService<CreateAgentInput, UpdateAgentInput, ListAgentsInput, AgentEntity> {
  readonly entityName = "agent";
  readonly contentDirName = "agents";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.agent; }

  protected formatEntity(raw: any): AgentEntity {
    // 安全（#20）：API 响应永不返回明文 apiKey。agent.apiKey 字段仅供 DB 存储，
    // LLM 实际使用 config providers 的 env key（llmClient provider.apiKey），不读此字段。
    const { apiKey: _omitApiKey, ...rest } = raw;
    return {
      ...rest,
      apiKey: null,
      tools: raw.tools ? raw.tools.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  // R19：列表裁剪——排除 systemPrompt（KB 级，Chat 用 agent.getById 取）、apiKey（安全）、
  // sourceSlug/sourceMtime（同步用，列表不需要）。详情走 getById 取全量。
  protected override getListSelect(): any {
    return {
      id: true, name: true, autoName: true, description: true, model: true, tools: true,
      tier: true, workspaceId: true, parentId: true, heartbeatModel: true,
      heartbeat: true, heartbeatSuspendedAt: true, status: true, source: true,
      deletedAt: true, deletedBy: true, createdAt: true, updatedAt: true,
    };
  }

  protected buildListWhere(input: ListAgentsInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    // Swarm 过滤
    if (input.tier) where.tier = input.tier;
    if (input.workspaceId) where.workspaceId = input.workspaceId;
    if (input.parentId) where.parentId = input.parentId;
    if (input.status) where.status = input.status;
    else where.status = { not: "deleted" }; // 默认不返回 tombstone
    return where;
  }

  protected override getOrderBy(input: ListAgentsInput): any {
    // tier DESC 使 "super" 排最前（字典序 super > sub > manager），
    // 前端页内再按 super>manager>sub 精确排序；避免超级 Agent 沉到后面分页
    if ((input as any).orderBy) return super.getOrderBy(input);
    return [{ tier: "desc" }, { createdAt: "desc" }];
  }

  protected buildCreateData(input: CreateAgentInput): any {
    const tools = materializeAgentTools(input.tools);
    return {
      name: input.name,
      description: input.description,
      model: input.model,
      systemPrompt: input.systemPrompt,
      tools: tools.join(","),
      // Swarm 字段（tier 默认 sub）
      tier: input.tier ?? "sub",
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.heartbeatModel !== undefined ? { heartbeatModel: input.heartbeatModel } : {}),
      ...(input.heartbeat !== undefined ? { heartbeat: input.heartbeat } : {}),
    };
  }

  protected buildUpdateData(input: UpdateAgentInput): any {
    const { id: _id, tools, name, tier, workspaceId, parentId, source, apiKey, heartbeatModel, heartbeat, status, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name;
    if (tools !== undefined) updateData.tools = materializeAgentTools(tools).join(",");
    if (tier !== undefined) updateData.tier = tier;
    if (workspaceId !== undefined) updateData.workspaceId = workspaceId;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (source !== undefined) updateData.source = source;
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (heartbeatModel !== undefined) updateData.heartbeatModel = heartbeatModel;
    if (heartbeat !== undefined) updateData.heartbeat = heartbeat;
    if (status !== undefined) updateData.status = status;
    return updateData;
  }

  protected serializeToFile(entity: AgentEntity): string {
    const toolsYaml = entity.tools.length > 0 ? `\ntools:\n` + entity.tools.map((t) => `  - "${t}"`).join("\n") : "\ntools: []";
    return `---
name: "${entity.name.replace(/"/g, '\\"')}"
description: ${entity.description ? `"${entity.description.replace(/"/g, '\\"')}"` : "null"}
model: "${entity.model}"
tier: "${entity.tier}"${toolsYaml}
source: ${entity.source ? `"${entity.source.replace(/"/g, '\\"')}"` : "null"}
---
${entity.systemPrompt}
`;
  }

  protected getFileSlug(entity: AgentEntity): string { return `${entity.name}-${entity.id.slice(-6)}`; }

  // P11：FTS 增量；每个 Agent 创建后立刻有一条空主会话（真实 sessionId，避免 Chat「无会话」空态）
  protected override async afterCreate(entity: AgentEntity, input: CreateAgentInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("agent", entity.id, entity.name, `${entity.description ?? ""}\n${entity.systemPrompt ?? ""}`);
    const { ensureMainSession } = await import("./infra/ensureMainSession.js");
    await ensureMainSession(this.prisma, {
      agentId: entity.id,
      title: `${entity.name} 主会话`,
      model: entity.model,
    }).catch((err) => {
      console.warn(`[AgentService] ensureMainSession 失败 agentId=${entity.id}:`, err);
    });
    // A14：通知 heartbeatEngine / agentSchemaCache 等 agent 配置变更
    this.eventBus.emit("agent.created", entity);
  }
  protected override async afterUpdate(entity: AgentEntity, existing: any, input: UpdateAgentInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("agent", entity.id, entity.name, `${entity.description ?? ""}\n${entity.systemPrompt ?? ""}`);
    this.eventBus.emit("agent.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("agent", existing.id);
    this.eventBus.emit("agent.deleted", existing);
  }

  // 超级 Agent 全局唯一——创建时拦截
  protected override async validateCreate(input: CreateAgentInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
    if (input.tier === "super") {
      const existingSuper = await this.prisma.agent.findFirst({
        where: { tier: "super", status: { not: "deleted" } },
      });
      if (existingSuper) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "已存在超级 Agent，全局只允许一个。请编辑现有超级 Agent 而非创建新的。",
        });
      }
    }
  }

  protected override async validateUpdate(input: UpdateAgentInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) await this.assertUnique("name", input.name, "更新", input.id);
    // Q1：超级 Agent 禁止降级 / 改 tier；禁止把其他 Agent 改成第二个 super
    if (existing.tier === "super" && input.tier !== undefined && input.tier !== "super") {
      throw new ServiceValidationError(
        failure({
          code: "SUPER_TIER_IMMUTABLE",
          message: "超级 Agent 的 tier 不可修改（禁止自降级）。",
          retryable: false,
          operation: "update",
          entity: this.entityName,
        }),
      );
    }
    if (input.tier === "super" && existing.tier !== "super") {
      throw new ServiceValidationError(
        failure({
          code: "SUPER_AGENT_UNIQUE",
          message: "不能将其他 Agent 提升为超级 Agent（全局唯一，由系统初始化创建）。",
          retryable: false,
          operation: "update",
          entity: this.entityName,
        }),
      );
    }
  }

  /**
   * W16d-2：心跳配置变更 = 人工修复信号 → consecutiveFailures 清零，
   * suspended 标记随后由 heartbeatEngine.refresh() 个体化摘除（计数清零是其唯一恢复条件）。
   * 判定字段：heartbeat.enabled/cron/goal + heartbeatModel（改模型常是修 LLM 配置）；
   * 仅「值确实变化」才清零——原样保存不算修复，不把 suspended 变成形式检查。
   */
  override async update(input: UpdateAgentInput): Promise<OperationResult<AgentEntity>> {
    if (input.heartbeat !== undefined || input.heartbeatModel !== undefined) {
      const existing = await this.delegate.findUnique({
        where: { id: input.id },
        select: { heartbeat: true, heartbeatModel: true },
      });
      if (existing) {
        const prev = (existing.heartbeat ?? null) as {
          enabled?: boolean;
          cron?: string;
          goal?: string;
        } | null;
        const next = input.heartbeat as { enabled?: boolean; cron?: string; goal?: string } | undefined;
        const heartbeatChanged =
          next !== undefined &&
          (next.enabled !== prev?.enabled || next.cron !== prev?.cron || next.goal !== prev?.goal);
        const modelChanged =
          input.heartbeatModel !== undefined && input.heartbeatModel !== existing.heartbeatModel;
        if ((heartbeatChanged || modelChanged) && (next ?? prev)) {
          const base = (next ?? prev) as NonNullable<UpdateAgentInput["heartbeat"]>;
          input = { ...input, heartbeat: { ...base, consecutiveFailures: 0 } };
        }
      }
    }
    return super.update(input);
  }

  // 超级 Agent 不可删除——系统核心，删除会导致 Swarm 体系崩溃
  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (existing?.tier === "super") {
      return failure({
        code: "SUPER_AGENT_NOT_DELETABLE",
        message: "超级 Agent 不可删除。它是 Swarm 体系的核心，删除将导致整个系统瘫痪。",
        details: { id, tier: "super" },
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    return super.delete(id);
  }

  // A6：批量删除，保留文件清理 + FTS 移除语义。超级 Agent 自动跳过。
  async bulkDelete(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    const existing = await this.prisma.agent.findMany({ where: { id: { in: ids } } });
    // 超级 Agent 不可删除，从删除列表中排除
    const deletableAgents = existing.filter((a: any) => a.tier !== "super");
    const superAgents = existing.filter((a: any) => a.tier === "super");
    for (const sa of superAgents) {
      errors.push(`${sa.id}: 超级 Agent 不可删除`);
    }
    const existingIds = new Set(deletableAgents.map((e: any) => e.id));
    const result = await this.prisma.agent.deleteMany({ where: { id: { in: [...existingIds] } } });
    for (const raw of deletableAgents) {
      try {
        this.deleteFile(this.formatEntity(raw));
      } catch (e) {
        // #6：文件删除失败不阻塞，但记录到 stderr 便于发现 DB 与文件不一致
        console.error(`[Agent.bulkDelete] 删除配置文件失败 agent=${raw.id}:`, e instanceof Error ? e.message : e);
      }
      await this.removeFts("agent", raw.id);
    }
    for (const id of ids) {
      if (!existingIds.has(id) && !superAgents.some((sa: any) => sa.id === id)) errors.push(`${id}: 不存在`);
    }
    return { deleted: result.count, errors };
  }

  // name 不再 @unique（swarm 允许重名，#37），用 id 做全局唯一标识
  // sourceSlug 仍 @unique，由 getFileSlug 生成唯一 slug
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

  private skillKindOf(entity: SkillEntity): "procedural" | "executable" | "reference" {
    return parseSkillKind(entity.metaJson, "executable");
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
    const kind = this.skillKindOf(entity);
    const lines = [
      `name: "${entity.name.replace(/"/g, '\\"')}"`,
      `description: "${entity.description.replace(/"/g, '\\"')}"`,
      `icon: ${entity.icon ? `"${entity.icon}"` : "null"}`,
      `trigger: ${entity.trigger ? `"${entity.trigger}"` : "null"}`,
      `enabled: ${entity.enabled}`,
      `kind: ${kind}`,
    ];
    if (meta.model) lines.push(`model: "${meta.model}"`);
    if (meta.context) lines.push(`context: ${meta.context}`);
    if (Array.isArray(meta.allowedTools) && meta.allowedTools.length) {
      lines.push(`allowed-tools:\n${(meta.allowedTools as string[]).map((t) => `  - ${t}`).join("\n")}`);
    }
    return `---\n${lines.join("\n")}\n---\n${entity.code}\n`;
  }

  /** procedural → `{name}/SKILL.md`；其余扁平 `{name}.md` */
  protected getFileSlug(entity: SkillEntity): string {
    return skillFileSlug(entity.name, this.skillKindOf(entity));
  }

  // P11：FTS 增量
  protected override async afterCreate(entity: SkillEntity, input: CreateSkillInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("skill", entity.id, entity.name, `${entity.description}\n${entity.code}`);
    // A9：通知 agentSchemaCache 失效
    this.eventBus.emit("skill.created", entity);
  }
  protected override async afterUpdate(entity: SkillEntity, existing: any, input: UpdateSkillInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("skill", entity.id, entity.name, `${entity.description}\n${entity.code}`);
    this.eventBus.emit("skill.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("skill", existing.id);
    this.eventBus.emit("skill.deleted", existing);
  }

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
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
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
    const transport = raw.transport === "http" ? "http" : "stdio";
    return {
      ...raw,
      transport,
      command: raw.command ?? "",
      args: typeof raw.args === "string" ? JSON.parse(raw.args) : (raw.args || []),
      env: typeof raw.env === "string" ? JSON.parse(raw.env) : (raw.env || {}),
      url: raw.url ?? null,
      headers: typeof raw.headers === "string" ? JSON.parse(raw.headers) : (raw.headers || {}),
    };
  }

  protected buildListWhere(input: ListMcpServersInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { command: { contains: input.keyword } },
        { url: { contains: input.keyword } },
      ];
    }
    return where;
  }

  protected buildCreateData(input: CreateMcpServerInput): any {
    return {
      name: input.name,
      transport: input.transport ?? "stdio",
      command: input.command ?? "",
      args: JSON.stringify(input.args ?? []),
      env: JSON.stringify(input.env ?? {}),
      url: input.url?.trim() || null,
      headers: JSON.stringify(input.headers ?? {}),
      enabled: input.enabled,
    };
  }

  protected buildUpdateData(input: UpdateMcpServerInput): any {
    const { id: _id, args, env, headers, ...data } = input;
    const updateData: any = { ...data };
    if (args !== undefined) updateData.args = JSON.stringify(args);
    if (env !== undefined) updateData.env = JSON.stringify(env);
    if (headers !== undefined) updateData.headers = JSON.stringify(headers);
    if (input.url !== undefined) updateData.url = input.url?.trim() || null;
    return updateData;
  }

  protected serializeToFile(entity: McpServerEntity): string {
    const body: Record<string, unknown> = {
      name: entity.name,
      transport: entity.transport,
      enabled: entity.enabled,
    };
    if (entity.transport === "http") {
      body.url = entity.url;
      body.headers = entity.headers ?? {};
      if (entity.command) body.command = entity.command;
    } else {
      body.command = entity.command;
      body.args = entity.args;
      body.env = entity.env;
    }
    return JSON.stringify(body, null, 2) + "\n";
  }

  protected getFileSlug(entity: McpServerEntity): string { return entity.name; }

  // A9：MCP CRUD 后 emit 事件；D5：FTS 增量挂钩
  protected override async afterCreate(entity: McpServerEntity, input: CreateMcpServerInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("mcp", entity.id, entity.name, entity.command ?? "");
    this.eventBus.emit("mcp.created", entity);
  }
  protected override async afterUpdate(entity: McpServerEntity, existing: any, input: UpdateMcpServerInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("mcp", entity.id, entity.name, entity.command ?? "");
    this.eventBus.emit("mcp.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("mcp", existing.id);
    this.eventBus.emit("mcp.deleted", existing);
  }

  protected override async validateCreate(input: CreateMcpServerInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
    this.assertMcpTransport(input.transport ?? "stdio", input.command, input.url);
  }

  protected override async validateUpdate(input: UpdateMcpServerInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
    const transport = (input.transport ?? existing.transport ?? "stdio") as "stdio" | "http";
    const command = input.command !== undefined ? input.command : existing.command;
    const url = input.url !== undefined ? input.url : existing.url;
    this.assertMcpTransport(transport, command, url);
  }

  private assertMcpTransport(
    transport: "stdio" | "http",
    command: string | null | undefined,
    url: string | null | undefined,
  ): void {
    if (transport === "stdio" && !String(command ?? "").trim()) {
      throw new ServiceValidationError(
        failure({
          code: "BAD_REQUEST",
          message: "stdio 传输必须填写 command",
          retryable: false,
          operation: "validate",
          entity: this.entityName,
        }),
      );
    }
    if (transport === "http" && !String(url ?? "").trim()) {
      throw new ServiceValidationError(
        failure({
          code: "BAD_REQUEST",
          message: "http 传输必须填写 url",
          retryable: false,
          operation: "validate",
          entity: this.entityName,
        }),
      );
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
  scope: string;
  agentId?: string | null;
  status?: string;
  attribution?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  supersededBy?: string | null;
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
    if (input.scope) where.scope = input.scope;
    if (input.status) where.status = input.status;
    else where.status = { not: "superseded" }; // 默认只看 active
    if (input.keyword) {
      where.OR = [{ content: { contains: input.keyword } }, { keywords: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateMemoryInput): any {
    const data: any = {
      content: input.content,
      type: input.type,
      strength: input.strength,
      keywords: input.keywords.join(","),
      scope: input.scope?.trim() || "global",
      status: "active",
    };
    const extra = input as any;
    if (extra.agentId) data.agentId = extra.agentId;
    if (extra.contentHash) data.contentHash = extra.contentHash;
    if (input.attribution) data.attribution = input.attribution;
    if (input.validFrom !== undefined) data.validFrom = input.validFrom;
    if (input.validTo !== undefined) data.validTo = input.validTo;
    return data;
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
        ...(entity.scope && entity.scope !== "global" ? { scope: entity.scope } : {}),
      },
      { lineWidth: -1, noRefs: true },
    );
    return `---\n${frontmatter}---\n\n${entity.content}\n`;
  }

  protected getFileSlug(entity: MemoryEntity): string { return entity.id; }

  // P11：FTS 增量
  protected override async afterCreate(entity: MemoryEntity, input: CreateMemoryInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }
  protected override async afterUpdate(entity: MemoryEntity, existing: any, input: UpdateMemoryInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("memory", existing.id);
  }
}

/** ChatSession 聊天会话 */
export interface SessionEntity {
  id: string;
  title: string;
  autoName?: string | null;
  model: string;
  systemPrompt: string | null;
  agentId: string | null;
  // Swarm/Subagent 扩展字段（数据库有默认值，普通会话可省略）
  parentSessionId?: string | null;
  kind?: "chat" | "subagent";
  status?: import("@knowpilot/shared").SessionStatus;
  taskDescription?: string | null;
  isMainSession?: boolean;
  contextSummary?: string | null;
  contextCompactedAt?: Date | string | null;
  rotatedToSessionId?: string | null;
  /** 会话级待办清单（todo_write / todo_read） */
  todoState?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionService extends BaseService<CreateSessionInput, UpdateSessionInput, ListSessionsInput, SessionEntity> {
  readonly entityName = "session";
  protected get delegate() { return this.prisma.chatSession; }
  protected formatEntity(raw: any): SessionEntity { return raw; }
  // 会话列表按 updatedAt 排序：用户在旧会话发消息后，MessageService.afterCreate 会刷新
  // session.updatedAt，使该会话浮到侧栏顶部。原默认 createdAt 排序导致旧会话永远停在原位。
  protected override get defaultOrderBy(): string { return "updatedAt"; }

  protected buildListWhere(input: ListSessionsInput): any {
    const where: any = {};
    if (input.keyword) where.title = { contains: input.keyword };
    if (input.agentIds && input.agentIds.length > 0) where.agentId = { in: input.agentIds };
    if (input.parentSessionId !== undefined) where.parentSessionId = input.parentSessionId;
    if (input.kind) where.kind = input.kind;
    if (input.status) where.status = input.status;
    return where;
  }

  // A1：agentIds 批量模式不分页，一次拉回所有匹配会话（take 上限 500），
  // 供 WorkspaceTree 在内存按 agentId 分组，消除「每个展开 Agent 一次查询」的 N+1。
  async list(input: ListSessionsInput): Promise<PaginatedResult<SessionEntity>> {
    if (input.agentIds && input.agentIds.length > 0) {
      const where = this.buildListWhere(input);
      const items = await this.delegate.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
      const formatted = items.map((i: any) => this.formatEntity(i));
      return { items: formatted, total: formatted.length, page: 1, pageSize: formatted.length, totalPages: 1 };
    }
    return super.list(input);
  }

  protected buildCreateData(input: CreateSessionInput): any {
    const { parentSessionId, kind, taskDescription, status, goalState, ...rest } = input;
    return {
      ...rest,
      ...(parentSessionId !== undefined ? { parentSessionId } : {}),
      ...(kind ? { kind } : {}),
      ...(taskDescription !== undefined ? { taskDescription } : {}),
      ...(status ? { status } : {}),
      ...(goalState !== undefined ? { goalState: goalState ?? undefined } : {}),
    };
  }
  protected buildUpdateData(input: UpdateSessionInput): any {
    const { id: _id, status, taskDescription, goalState, ...data } = input;
    return {
      ...data,
      ...(status ? { status } : {}),
      ...(taskDescription !== undefined ? { taskDescription } : {}),
      ...(goalState !== undefined ? { goalState: goalState === null ? null : goalState } : {}),
    };
  }

  override async getById(id: string): Promise<any> {
    // P0-1 彻底解耦：getById 只返会话元数据（title/model/agentId/kind/status...），不含 messages。
    // 消息由前端 useInfiniteQuery 走 message.listForChat（cursor 分页）独立加载。
    const session = await this.prisma.chatSession.findUnique({ where: { id } });
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return session;
  }

  // A4：轻量 getById，不 include messages。供 stop/rerun 等只需 kind/status 的场景使用，
  // 避免每次拉 500 条消息。
  async getByIdLite(id: string): Promise<any> {
    const session = await this.prisma.chatSession.findUnique({ where: { id } });
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return session;
  }

  /**
   * C-3 会话手动恢复（v10）：paused → running 续跑未完成的 ReAct 轮。
   *
   * 背景：服务端重启后 R-2 把僵尸 running 会话标 paused（进程内 ReAct 状态随进程死亡，
   * 消息链在 ChatMessage 表扁平存储，chatAgentStream 从扁平链重建上下文续跑，
   * 不重复生成已有 assistant 消息）。设计：手动恢复，不做自动恢复。
   *
   * 不变量（全部收条件写/原子操作，不靠编排层时序猜测）：
   * 1. 仅 status="paused" 可恢复；active/failed/archived/completed 等 → BAD_REQUEST（说明原因）。
   * 2. 唯一互斥点 = 条件写 updateMany where {id, status:"paused"} → {status:"running"}：
   *    count=1 获得恢复权；count=0 重读——已 running → 幂等返回（并发 double-resume
   *    落选方不报错、不重复起流）；其它 → BAD_REQUEST。全仓只有这一处 paused→running，
   *    并发下至多一个调用方起流，不加第二层锁。
   * 3. 系统提示消息（role:"user", source:"system"）由 chatAgentStream 在起流后写入——
   *    注入与起流同源，不存在「消息已写、流未起」的孤儿窗口，故回滚无需删消息。
   * 4. 起流失败回滚（宁漏勿错）：startIfNotRunning 返回 false = 已有活跃流接管
   *    （竞态幂等，状态维持 running，不算失败）；抛错 → 条件写回滚 running→paused。
   *    可判定依据：hub.start 的全部抛错点都在 runs 占位与 runner 执行之前
   *    （isRunning 检查；maxEventIdFor 内部已吞错不抛），抛错 ⟹ runner 未执行
   *    ⟹ 消息必然未写入 ⟹ 回滚安全完整。回滚同走条件写 where status:"running"：
   *    期间已被 stop/接管则 count=0 不误滚。
   * 5. 终态归位挂在 runner 内部：run 结束时若状态仍 running——
   *    done → subagent 会话 "completed" / 其它 "active"；error/中断 → "paused"
   *    （瞬时错误不判死刑，保留再次手动恢复的闭环）。写在 runner 内、hub 标 completed
   *    之前，与 superior drain 链的 waitFor 形成 happens-before（drain 只会在本 runner
   *    结束后才可能把状态重新置 running），无 check-then-act 窗口；条件写 where
   *    status:"running" 保证期间被 stop（paused）/ report_back（completed）接管时不覆盖。
   */
  async resume(input: { id: string }): Promise<{
    id: string;
    status: string;
    resumed: boolean;
    streamStarted: boolean;
    /** 队首为 superior 时：已挂服务端 drain，未注入「继续任务」并行流 */
    superiorDrainQueued?: boolean;
  }> {
    const session = await this.getByIdLite(input.id); // 不存在 → NOT_FOUND

    // 互斥点（唯一）：条件写抢占恢复权
    const claim = await this.prisma.chatSession.updateMany({
      where: { id: input.id, status: "paused" },
      data: { status: "running" },
    });

    if (claim.count === 0) {
      // 未获得恢复权：重读当前状态，区分「幂等」与「拒绝」
      const current = await this.getByIdLite(input.id);
      if (current.status === "running") {
        // 并发 double-resume 落选方 / 重复调用：不报错、不重复起流
        return { id: input.id, status: "running", resumed: false, streamStarted: false };
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `恢复会话失败：仅「已暂停（paused）」的会话可恢复运行，当前状态为「${current.status}」。` +
          (current.status === "archived" ? "已归档会话请前往续写会话。" : "请刷新会话列表确认状态后重试。"),
      });
    }

    // 获得恢复权。起流走交互式通道（v8 Q2 口径：不入池但计入全局占用——
    // hub.runningCount() 即交互 running 计数，池准入据此约束，不新造限流层）。
    // infra 全部动态 import 防环（agentStream 处于 ReAct 依赖环内，与 SessionService.delete 同模式）。
    const { getStreamHub } = await import("./infra/sessionStreamHub.js");
    const hub = getStreamHub();
    if (!hub) {
      // 未起流（runner 未执行、消息未写入）→ 安全回滚
      await this.prisma.chatSession.updateMany({
        where: { id: input.id, status: "running" },
        data: { status: "paused" },
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "恢复会话失败：StreamHub 未初始化，已回滚为 paused，请重试。",
      });
    }

    const { getServiceContainer } = await import("./infra/serviceContainer.js");
    const services = getServiceContainer(this.prisma, this.eventBus, this.config);
    const config = this.config;

    // 队首 superior：只挂服务端 drain，禁止与「继续任务」并行起流（保 FIFO）
    const queueHead = (await services.sessionQueueItem.listBySession(input.id))[0];
    if (queueHead?.kind === "superior" && session.agentId) {
      const { enqueueSuperiorDrainForSession } = await import("./infra/tools/native/swarm.js");
      const drainPromise = enqueueSuperiorDrainForSession({
        sessionId: input.id,
        targetAgentId: session.agentId,
        config,
        services,
      });
      void drainPromise.finally(async () => {
        if (hub.isRunning(input.id)) return;
        const nextStatus = session.kind === "subagent" ? "completed" : "active";
        await this.prisma.chatSession
          .updateMany({
            where: { id: input.id, status: "running" },
            data: { status: nextStatus },
          })
          .catch((settleErr) => {
            console.warn(`[session.resume] superior drain 后归位失败 session=${input.id}:`, settleErr);
          });
      });
      return {
        id: input.id,
        status: "running",
        resumed: true,
        streamStarted: false,
        superiorDrainQueued: true,
      };
    }

    // 优先 drain 队首孤儿 ask_user 答复（重启后无 waiter 入队的项）：以答复起流，勿盲目「继续任务」
    const orphanAnswer = await services.sessionQueueItem.claimHeadAskUserOrphan(input.id);
    const { buildResumeHintIfAskPending } = await import("./infra/askUserGate.js");
    const askHint = orphanAnswer ? null : buildResumeHintIfAskPending(input.id);
    const body: AgentChatInput = {
      sessionId: input.id,
      agentId: session.agentId ?? undefined,
      message:
        orphanAnswer?.content ??
        askHint ??
        "（服务已重启，请继续完成未完成的任务）",
      // 孤儿答复按用户消息上链；其余恢复注入走 system 去重路径
      source: orphanAnswer ? "user" : "system",
      // 子任务血统允许 report_back（与 asyncJobManager autoConsume 同口径）
      runOrigin: session.parentSessionId || session.kind === "subagent" ? "parent" : "user",
    };

    const { createTrpcInvoker } = await import("./infra/trpcInvoker.js");
    const invokeTrpc = createTrpcInvoker({ services });
    const { chatAgentStream } = await import("./infra/agentStream.js");

    try {
      const started = await hub.startIfNotRunning(input.id, body, async (emit, signal) => {
        // chatAgentStream 自身吞错并 emit error 事件（不 rethrow），
        // 只能追踪事件流判定终局；防御性 catch 兜底未来改动。
        // 用对象持有终局标记：绕过 TS 对闭包捕获变量的窄化（闭包内赋值不被 CFA 追踪）
        const track = { terminal: "error" as "done" | "error" };
        const trackingEmit = (event: AgentStreamEvent) => {
          if (event.type === "done") track.terminal = "done";
          else if (event.type === "error") track.terminal = "error";
          emit(event);
        };
        try {
          await chatAgentStream(services, config, body, invokeTrpc, trackingEmit, signal);
        } catch {
          track.terminal = "error";
        }
        // 终态归位（runner 内、hub 标 completed 之前，见头注 5）。
        const nextStatus =
          track.terminal === "done" ? (session.kind === "subagent" ? "completed" : "active") : "paused";
        try {
          await this.prisma.chatSession.updateMany({
            where: { id: input.id, status: "running" },
            data: { status: nextStatus },
          });
        } catch (settleErr) {
          // 归位失败不阻塞流本身：R-2 重启首扫会把尸体 running 再标 paused，留人工恢复
          console.warn(`[session.resume] 终态归位失败 session=${input.id}:`, settleErr);
        }
      });

      if (!started) {
        // 已有活跃流接管（如前端断线重连先一步 POST 起流）：竞态幂等，状态维持 running
        return { id: input.id, status: "running", resumed: true, streamStarted: false };
      }
      return { id: input.id, status: "running", resumed: true, streamStarted: true };
    } catch (err) {
      // startIfNotRunning 抛错 ⟹ runner 未执行 ⟹ 系统消息必然未写入 ⟹ 安全回滚（头注 4）
      await this.prisma.chatSession
        .updateMany({
          where: { id: input.id, status: "running" },
          data: { status: "paused" },
        })
        .catch((rbErr) => {
          console.warn(`[session.resume] 回滚 paused 失败 session=${input.id}:`, rbErr);
        });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `恢复会话失败：启动续跑流异常（${err instanceof Error ? err.message : String(err)}），已回滚为 paused，请重试。`,
      });
    }
  }

  async deleteMany(_input?: Record<string, never>): Promise<{ count: number }> {
    // 先清无 FK 级联的附属数据，再删会话（ChatMessage / SessionQueueItem 会 cascade）
    await this.prisma.sessionStreamEvent.deleteMany({}).catch(() => ({ count: 0 }));
    await this.prisma.task.deleteMany({
      where: { OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }] },
    }).catch(() => ({ count: 0 }));
    const result = await this.prisma.chatSession.deleteMany({});
    return { count: result.count };
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    // 删父会话时一并删子会话，避免 parentSessionId 断链后「删不干净」
    const children = await this.prisma.chatSession.findMany({
      where: { parentSessionId: id },
      select: { id: true },
    });
    // 先停所有运行中的 Agent 流 / 清理 StreamHub 内存状态，否则删除 DB 记录后
    // zombie stream 仍在后台跑、消耗 LLM token，且 cleanupTimer 触发时 runs.delete 找不到对应条目
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      for (const child of children) {
        hub?.stop(child.id);
        await hub?.clear(child.id).catch(() => {});
      }
      hub?.stop(id);
      await hub?.clear(id).catch(() => {});
    } catch {
      /* StreamHub 未初始化，忽略 */
    }
    for (const child of children) {
      await this.prisma.task.deleteMany({ where: { sessionId: child.id } }).catch(() => {});
      await this.prisma.sessionStreamEvent.deleteMany({ where: { sessionId: child.id } }).catch(() => {});
      await super.delete(child.id);
    }
    await this.prisma.task.deleteMany({ where: { sessionId: id } }).catch(() => {});
    await this.prisma.sessionStreamEvent.deleteMany({ where: { sessionId: id } }).catch(() => {});
    return super.delete(id);
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
  finishReason?: string | null;
  source?: string;
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

  protected override async afterCreate(entity: MessageEntity, input: CreateMessageInput): Promise<void> {
    // 每次写入消息都把父会话顶到列表最前，确保后台更新/子 Agent 返回后父会话能被立即找到。
    try {
      await this.prisma.chatSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date() },
      });
    } catch {
      // 会话可能已被删除，忽略
    }
    await super.afterCreate(entity, input);
    // 广播 message_upserted：前端 reducer 直接 patch messages[]，不再靠 invalidate→refetch 闪烁刷新。
    // 动态 import 避免与 sessionStreamHub 循环依赖。
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: {
          id: entity.id,
          role: entity.role,
          content: entity.content,
          toolCalls: entity.toolCalls ?? undefined,
          toolResults: entity.toolResults ?? undefined,
          tokenUsage: entity.tokenUsage ?? undefined,
          attachments: entity.attachments ?? undefined,
          source: entity.source ?? null,
          createdAt: entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
        },
      });
    } catch {
      /* StreamHub 未初始化或会话已清理，忽略 */
    }
  }

  protected override async afterUpdate(entity: MessageEntity, _existing: any, _input: UpdateMessageInput): Promise<void> {
    await super.afterUpdate(entity, _existing, _input);
    // update（如 switchVersion）也推 message_upserted，前端 MessageStore 直接 patch
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: {
          id: entity.id,
          role: entity.role,
          content: entity.content,
          toolCalls: entity.toolCalls ?? undefined,
          toolResults: entity.toolResults ?? undefined,
          tokenUsage: entity.tokenUsage ?? undefined,
          attachments: entity.attachments ?? undefined,
          source: entity.source ?? null,
          createdAt: entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
        },
      });
    } catch {
      /* ignore */
    }
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    const sessionId: string | undefined = existing?.sessionId;
    const messageId: string | undefined = existing?.id;
    if (!sessionId || !messageId) return;
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(sessionId, {
        type: "message_deleted",
        sessionId,
        messageId,
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * 构建 LLM 上下文专用历史：
   * - 有 since（通常 = contextCompactedAt）：取该时刻起的最近 limit 条
   * - 无 since：取全会话最近 limit 条（避免 page=1 asc 拿到最旧页）
   * 页面展示仍走 listForChat，压缩不删气泡。
   */
  async listForLlmContext(input: {
    sessionId: string;
    since?: Date | string | null;
    limit?: number;
  }): Promise<MessageEntity[]> {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const since = input.since ? new Date(input.since) : null;
    const where =
      since && !Number.isNaN(since.getTime())
        ? { sessionId: input.sessionId, createdAt: { gte: since } }
        : { sessionId: input.sessionId };
    const items = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    items.reverse();
    return items.map((i: any) => this.formatEntity(i));
  }

  // P0-1 彻底解耦：Chat 专用 cursor 无限查询。
  // 无 cursor：返最近 limit 条（asc）。有 cursor：返早于 cursor(消息 id) 的 limit 条（asc）。
  // nextCursor = 本页最旧消息 id（供下页继续向上翻），items.length < limit 时无 nextCursor（已到顶）。
  async listForChat(input: { sessionId: string; cursor?: string; limit?: number }): Promise<{ items: MessageEntity[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    let items: any[];
    if (input.cursor) {
      const cur = await this.prisma.chatMessage.findUnique({ where: { id: input.cursor }, select: { createdAt: true } });
      if (!cur) return { items: [] };
      items = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId, createdAt: { lt: cur.createdAt } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    } else {
      items = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    }
    items.reverse(); // asc，便于前端按序渲染
    const formatted = items.map((i: any) => this.formatEntity(i));
    const nextCursor = formatted.length >= limit ? formatted[0]?.id : undefined;
    return { items: formatted, nextCursor };
  }
}

/**
 * W14 幂等防线：superior 镜像（AgentMessage → 会话发送队列）投递前的对账阈值。
 * 滞留 pending 超过该时长的 AgentMessage 视为「疑似已被其它管道投递过」，
 * 镜像入队前先查目标会话是否已有同内容消息。
 */
const SUPERIOR_MIRROR_STALE_MS = 5 * 60 * 1000;

export interface SessionQueueItemEntity {
  id: string;
  sessionId: string;
  kind: string;
  content: string;
  source: string;
  sourceName: string | null;
  agentMessageId: string | null;
  order: number;
  attachments: any;
  skillId: string | null;
  skillPrompt: string | null;
  createdAt: Date;
}

export class SessionQueueItemService extends BaseService<
  CreateSessionQueueItemInput,
  UpdateSessionQueueItemInput,
  ListSessionQueueItemsInput,
  SessionQueueItemEntity
> {
  readonly entityName = "sessionQueueItem";
  protected get delegate() { return this.prisma.sessionQueueItem; }
  protected formatEntity(raw: any): SessionQueueItemEntity { return raw; }
  protected buildListWhere(input: ListSessionQueueItemsInput): any { return { sessionId: input.sessionId }; }
  protected buildCreateData(input: CreateSessionQueueItemInput): any {
    return {
      sessionId: input.sessionId,
      kind: input.kind,
      content: input.content,
      source: input.source,
      sourceName: input.sourceName ?? null,
      agentMessageId: input.agentMessageId ?? null,
      attachments: input.attachments ?? null,
      skillId: input.skillId ?? null,
      skillPrompt: input.skillPrompt ?? null,
    };
  }
  protected buildUpdateData(input: UpdateSessionQueueItemInput): any {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override get defaultOrderBy(): string { return "order"; }
  protected override get defaultOrder(): "asc" | "desc" { return "asc"; }

  /** 推送 session_queue_update：创建/消费/删除/重排后让打开中的会话实时合并队列（不依赖刷新） */
  private async pushQueueUpdate(sessionId: string, kind: string): Promise<void> {
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      getStreamHub()?.pushExternalEvent(sessionId, {
        type: "session_queue_update",
        sessionId,
        kind,
      });
    } catch {
      /* hub 未初始化时忽略（单测 / 启动早期） */
    }
  }

  /** 创建时自动赋 order = 当前最大 order + 10；superior 幂等（同 agentMessageId 不重复） */
  override async create(input: CreateSessionQueueItemInput): Promise<OperationResult<SessionQueueItemEntity>> {
    const start = Date.now();
    try {
      if (input.kind === "superior" && input.agentMessageId) {
        const existing = await this.prisma.sessionQueueItem.findFirst({
          where: { sessionId: input.sessionId, agentMessageId: input.agentMessageId },
        });
        if (existing) {
          const entity = this.formatEntity(existing);
          // 幂等命中仍广播：晚订阅 / 首包空水合的前端可借此合并
          await this.pushQueueUpdate(entity.sessionId, entity.kind);
          return success({
            data: entity,
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }

        // W14 幂等防线：投递前先对账，命中则只回写状态、不再镜像注入（防重复投递）。
        // 返回 success 但无 data——前端各调用方（mirror / enqueue / runStream 迁移补写）
        // 对缺失 id 均有兜底（跳过入队 / 不补 dbId），不会当成错误。
        if (await this.shouldSkipSuperiorMirror(input)) {
          return success({
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }
      }

      const maxOrder = await this.prisma.sessionQueueItem.aggregate({
        where: { sessionId: input.sessionId },
        _max: { order: true },
      });
      const order = (maxOrder._max.order ?? -10) + 10;
      const raw = await this.prisma.sessionQueueItem.create({
        data: { ...this.buildCreateData(input), order },
      });
      const entity = this.formatEntity(raw);
      await this.afterCreate(entity, input);
      await this.pushQueueUpdate(entity.sessionId, entity.kind);
      return success({
        data: entity,
        operation: "create",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  /**
   * W14 幂等防线：AgentMessage 镜像入会话队列前的对账。返回 true = 跳过本次镜像。
   * - 已 delivered/consumed：Task 管道已认领投递过该消息（report_back 旁路邮箱），
   *   再镜像就是重复注入，直接跳过（账已记过，无需回写）。
   * - 滞留 pending 超 SUPERIOR_MIRROR_STALE_MS 且目标会话已有同 content 消息：
   *   只把 AgentMessage 回写 consumed，不再注入（taskRef 缺失时按内容兜底对账）。
   */
  private async shouldSkipSuperiorMirror(input: CreateSessionQueueItemInput): Promise<boolean> {
    if (!input.agentMessageId) return false;
    const agentMsg = await this.prisma.agentMessage.findUnique({
      where: { id: input.agentMessageId },
      select: { id: true, status: true, content: true, createdAt: true },
    });
    if (!agentMsg) return false;
    if (agentMsg.status !== "pending") return true;
    if (Date.now() - agentMsg.createdAt.getTime() <= SUPERIOR_MIRROR_STALE_MS) return false;
    const dup = await this.prisma.chatMessage.findFirst({
      where: { sessionId: input.sessionId, content: agentMsg.content },
      select: { id: true },
    });
    if (!dup) return false;
    // W16a-1：条件写在 where 里（而非先读后写）——仅 pending → consumed 直跳时兜底补 deliveredAt，
    // 并发竞态下已被 CLAIM 置 delivered 的真账 deliveredAt 不会被本回写覆写。
    await this.prisma.agentMessage
      .updateMany({
        where: { id: agentMsg.id, status: "pending" },
        data: { status: "consumed", deliveredAt: new Date() },
      })
      .catch(() => {
        /* 可能已被并发回写或删除，忽略 */
      });
    return true;
  }

  /** 按 session 列出全部队列项（按 order 升序），供 Chat UI 一次拉齐 */
  async listBySession(sessionId: string): Promise<SessionQueueItemEntity[]> {
    const rows = await this.prisma.sessionQueueItem.findMany({
      where: { sessionId },
      orderBy: { order: "asc" },
    });
    return rows.map((r) => this.formatEntity(r));
  }

  /**
   * resume / 恢复路径：仅当队首是 `kind=user` 且 `source=ask_user` 时软认领并返回内容。
   * 不越过 superior / 其它 user 项（保 FIFO）；认领失败（并发）返回 null。
   */
  async claimHeadAskUserOrphan(
    sessionId: string,
  ): Promise<{ id: string; content: string } | null> {
    const items = await this.listBySession(sessionId);
    const head = items[0];
    if (!head || head.kind !== "user" || head.source !== "ask_user") return null;
    const { claimed } = await this.consume(head.id);
    if (!claimed) return null;
    return { id: head.id, content: head.content };
  }

  /**
   * 消费一条队列项（软认领）：删除 SessionQueueItem + 标记 AgentMessage consumed（如适用）。
   * 删除即认领——item 不存在或并发落选（前端 drain 与服务端 superior drain 同抢一条）时
   * 返回 claimed:false，落选方静默跳过，不抛错。
   */
  async consume(id: string): Promise<{ success: boolean; claimed: boolean }> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item) {
      return { success: true, claimed: false };
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      // 删除即认领：deleteMany 原子返回受影响行数，并发双 consume 落选方 count=0
      const del = await tx.sessionQueueItem.deleteMany({ where: { id } });
      if (del.count === 0) return false;
      if (item.kind === "superior" && item.agentMessageId) {
        // W16a-1：delivered → consumed 不动 deliveredAt（CLAIM 真账）；pending 直跳 consumed 兜底补齐。
        // 已 consumed / 已删除均为幂等 no-op。
        const fromDelivered = await tx.agentMessage.updateMany({
          where: { id: item.agentMessageId, status: "delivered" },
          data: { status: "consumed" },
        });
        if (fromDelivered.count === 0) {
          await tx.agentMessage.updateMany({
            where: { id: item.agentMessageId, status: "pending" },
            data: { status: "consumed", deliveredAt: new Date() },
          });
        }
      }
      return true;
    });
    if (claimed) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return { success: true, claimed };
  }

  /** 批量重排序：按 orderedIds 顺序依次赋 order = index * 10 */
  async reorder(sessionId: string, orderedIds: string[]): Promise<{ success: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.sessionQueueItem.updateMany({
          where: { id: orderedIds[i], sessionId },
          data: { order: i * 10 },
        });
      }
    });
    await this.pushQueueUpdate(sessionId, "reorder");
    return { success: true };
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    const result = await super.delete(id);
    if (result.success && item) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return result;
  }
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
    // 安全：所有 Git 操作的 cwd 都必须经 resolveSafePath 校验并解析为绝对路径
    if (input.repoPath) return resolveSafePath(this.config, input.repoPath);
    if (input.repoId) {
      const repo = await this.getById(input.repoId);
      return resolveSafePath(this.config, repo.path);
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
    // R7：按会话过滤，供 listSessionAsyncJobs 在 DB 层精准查询
    if (input.sessionId) where.sessionId = input.sessionId;
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
    if (input.status) where.status = input.status;
    else where.status = { not: "deleted" }; // 默认不返回 tombstone
    return where;
  }
  protected buildCreateData(input: CreateWorkspaceInput) {
    const {
      autoCreateManager: _auto,
      withManager: _with,
      managerName: _mgrName,
      initialTask: _task,
      ...data
    } = input;
    return {
      ...data,
      status: "active",
      asyncSlotQuota: typeof input.asyncSlotQuota === "number" ? input.asyncSlotQuota : 2,
    };
  }
  protected buildUpdateData(input: UpdateWorkspaceInput) {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override getOrderBy(input: ListWorkspacesInput): any {
    // 系统 Workspace 置顶，其余按创建时间倒序
    if ((input as any).orderBy) return super.getOrderBy(input);
    return [{ isSystem: "desc" }, { createdAt: "desc" }];
  }

  protected override async validateCreate(input: CreateWorkspaceInput): Promise<void> {
    await this.assertUnique("path", input.path, "创建");
  }
  protected override async validateUpdate(input: UpdateWorkspaceInput, existing: any): Promise<void> {
    if (existing.isSystem) {
      if (input.status && input.status !== "active") {
        throw new ServiceValidationError(
          failure({
            code: "SYSTEM_WORKSPACE_IMMUTABLE",
            message: "系统 Workspace 不可归档或删除",
            suggestion: "系统 Workspace 是 KnowPilot 运行所必需，无法修改其状态。",
            retryable: false,
            operation: "update",
            entity: this.entityName,
          }),
        );
      }
      if (input.path && input.path !== existing.path) {
        throw new ServiceValidationError(
          failure({
            code: "SYSTEM_WORKSPACE_IMMUTABLE",
            message: "系统 Workspace 路径不可修改",
            suggestion: "系统 Workspace 路径固定，无法变更。",
            retryable: false,
            operation: "update",
            entity: this.entityName,
          }),
        );
      }
    }
    if (input.path && input.path !== existing.path) await this.assertUnique("path", input.path, "更新", input.id);
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (existing?.isSystem) {
      return failure({
        code: "SYSTEM_WORKSPACE_NOT_DELETABLE",
        message: "系统 Workspace 不可删除",
        suggestion: "系统 Workspace 是 KnowPilot 运行所必需。",
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    const hasSuperAgent = await this.prisma.agent.findFirst({
      where: { workspaceId: id, tier: "super", status: { not: "deleted" } },
    });
    if (hasSuperAgent) {
      return failure({
        code: "WORKSPACE_HAS_SUPER_AGENT",
        message: "该 Workspace 包含超级 Agent，不可删除",
        suggestion: "请先迁移或删除该 Workspace 下的超级 Agent 后再注销 Workspace。",
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    return super.delete(id);
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
  protected buildUpdateData(input: UpdateApprovalInput) {
    const { id: _id, ...data } = input;
    // 审批决策审计：进入决策终态（approved/rejected）时统一盖决策者与时间戳。
    // 当前单用户本地场景固定 "local-user"（AUTH_MODE=password 亦为同一本地账户）。
    if (input.status === "approved" || input.status === "rejected") {
      return { ...data, decidedBy: "local-user", decidedAt: new Date() };
    }
    return data;
  }

  /**
   * W11：人工拒绝是审批决策点——发 approval_resolved 显式事件，
   * 唤醒挂在该审批上的 run（awaiting_human → llm，注入拒绝消息让 LLM 收尾）。
   * approved 不在此发：执行完成（executeApprovedOperation）才发，携带执行结果。
   */
  protected override async afterUpdate(entity: any, existing: any, input: UpdateApprovalInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    if (input.status === "rejected") {
      notifyApprovalResolved(entity.id, {
        outcome: "rejected",
        approvalId: entity.id,
        toolName: entity.toolName ?? "unknown",
      });
    }
  }
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
  // P2-5：Runs 列表 UI 只需 status/agent/session/耗时/token/时间，裁剪 input/output/toolCalls/error 等大 JSON；
  // 详情走 getById 取全量。
  protected override getListSelect(): any {
    return {
      id: true,
      agentId: true,
      sessionId: true,
      status: true,
      durationMs: true,
      toolCallCount: true,
      tokenUsage: true,
      createdAt: true,
      updatedAt: true,
    };
  }
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

  // D5：Prompt FTS 增量挂钩（与 syncer upsert 对齐）
  protected override async afterCreate(entity: any, input: CreatePromptInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("prompt", entity.id, entity.name, `${entity.description ?? ""}\n${entity.content ?? ""}`);
  }
  protected override async afterUpdate(entity: any, existing: any, input: UpdatePromptInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("prompt", entity.id, entity.name, `${entity.description ?? ""}\n${entity.content ?? ""}`);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("prompt", existing.id);
  }

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
  // P1-5 / P1：CRUD 后清 credential vault 缓存 + 立即重新注入 config.integrations，
  // 用最新 DB 数据刷新（generation 计数器保证进行中的旧注入不会覆盖新值）。
  protected override async afterCreate(): Promise<void> { await invalidateIntegrationCredentials(this.config, this.prisma); }
  protected override async afterUpdate(): Promise<void> { await invalidateIntegrationCredentials(this.config, this.prisma); }
  protected override async afterDelete(): Promise<void> { await invalidateIntegrationCredentials(this.config, this.prisma); }
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
  fetchInterval: number | null;
  lastFetchedAt: Date | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
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
      fetchInterval: input.fetchInterval ?? 60,
      sourceSlug: slug,
    };
  }

  protected buildUpdateData(input: UpdateInfoSourceInput): any {
    const { id: _id, tags, name, url, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name.trim();
    if (url !== undefined) updateData.url = url.trim();
    if (tags !== undefined) updateData.tags = tags.join(",");
    if (input.fetchInterval === null) updateData.fetchInterval = null;
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
        fetchInterval: entity.fetchInterval,
      },
      null,
      2,
    )}\n`;
  }

  protected getFileSlug(entity: InfoSourceEntity): string {
    return entity.sourceSlug || this.slugifyName(entity.name);
  }

  // P10：InfoSource CRUD 后失效 capabilities 缓存（infoSources.enabled 计数）
  protected override async afterCreate(entity: InfoSourceEntity, input: CreateInfoSourceInput): Promise<void> {
    await super.afterCreate(entity, input);
    invalidateCapabilitiesCache();
  }
  protected override async afterUpdate(entity: InfoSourceEntity, existing: any, input: UpdateInfoSourceInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    invalidateCapabilitiesCache();
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    invalidateCapabilitiesCache();
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
