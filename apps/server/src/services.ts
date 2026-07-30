/**
 * KnowPilot 后端服务业务层 (Services Layer)
 *
 * 【扁平化 + 按需叶子拆分】：
 * 1. 本文件含 Service 错误定义、CRUD 基类 BaseService 与 FileSyncService，以及未拆出的实体 Service。
 * 2. Prisma ~30 model。本文件仅保留 Post/Agent/Session（与流式 hub/tree/swarm 重耦合）；Message 已拆叶子；
 *    其余业务 Service 在 `infra/entityServices/`，由 serviceContainer 直连叶子，禁止兼容 re-export。
 * 3. 禁止平行 `services/` 子目录树；体量过大时只允许上述 entityServices 叶子拆分。
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "node:crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type OperationResult,
  type NextStep,
  type CreatePostInput,
  type UpdatePostInput,
  type ListPostsInput,
  type RelatedPostsInput,
  type CreatePostFromChatInput,
  type CreateAgentInput,
  type UpdateAgentInput,
  type ListAgentsInput,
  materializeAgentTools,
  type CreateSessionInput,
  type UpdateSessionInput,
  type ListSessionsInput,
  type CreateMessageInput,
  type UpdateMessageInput,
  type ListMessagesInput,
  type AgentRunInput,
  type AgentChatInput,
  type WebSearchInput,
  type NativeExecuteInput,
  DEFAULT_POST_GARDEN,
  isValidGardenIdFormat,
  isReservedContentDir,
} from "@knowpilot/shared";
import { success, failure, failureFromError } from "./trpc/result.js";
import type { AppEventBus } from "./infra/eventBus.js";
import type { AppConfig } from "./infra/config.js";
import { resolveGardenDir } from "./infra/config.js";
import { stripLeadingMarkdownFrontmatter } from "./scripts/sync/utils.js";
import { upsertFtsRow, deleteFtsRow, searchFts, searchFtsByEntity } from "./infra/ftsIndex.js";
import { assertPathWithinProjectRoot } from "./infra/safePath.js";

/* ─── 1. 辅助类型与基类 ─── */

/** Post FTS body：含 garden/slug/category/tags，供相关推荐与全局搜索命中标签 */
function buildPostFtsBody(entity: {
  garden: string;
  slug: string;
  content?: string | null;
  category?: string | null;
  tags?: string[] | string | null;
}): string {
  const tags =
    Array.isArray(entity.tags)
      ? entity.tags.join(" ")
      : typeof entity.tags === "string"
        ? entity.tags.split(",").map((t) => t.trim()).filter(Boolean).join(" ")
        : "";
  return `[${entity.garden}] ${entity.slug}\ncategory:${entity.category ?? ""}\ntags:${tags}\n${entity.content ?? ""}`;
}

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
export function failureFromPrismaUnique(error: unknown, operation: string, entityName: string) {
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
    const gp = this.config.configPaths as Record<string, string>;
    const cp = this.config.contentPaths as Record<string, string>;
    return gp[this.contentDirName] || cp[this.contentDirName] || path.join(this.config.configDir, this.contentDirName);
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
      throw new Error(`${this.entityName} 文件路径越出存储根 ${this.contentDirName}：${slug}`);
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
    let provisionalWritten: TEntity | null = null;
    try {
      await this.validateCreate(input);
      const data = this.buildCreateData(input);
      if (!data.id) data.id = newEntityId();
      const provisional = this.formatEntity(this.buildProvisionalRaw(data));
      this.writeFile(provisional);
      provisionalWritten = provisional;
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
        // 用实体补偿删除（Post 多花园时仅凭 slug 无法定位文件）
        if (provisionalWritten) {
          try {
            this.deleteFile(provisionalWritten);
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
    let provisionalWritten: TEntity | null = null;
    let existingEntity: TEntity | null = null;
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("更新", id, Date.now() - start);
      await this.validateUpdate(input, existing);
      const updateData = this.buildUpdateData(input);
      const provisional = this.formatEntity(this.buildProvisionalRaw(updateData, existing));
      existingEntity = this.formatEntity(existing);
      const oldSlug = this.getExistingFileSlug(existing);
      const newSlug = this.getFileSlug(provisional);
      this.writeFile(provisional);
      provisionalWritten = provisional;
      try {
        const raw = await this.delegate.update({ where: { id }, data: updateData });
        const entity = this.formatEntity(raw);
        await this.syncFileMetaToDb(entity);
        // 路径或花园变更：删旧文件（deleteFile 走实体，支持多花园）
        if (this.shouldDeleteOldFileAfterUpdate(existingEntity, entity, oldSlug, newSlug)) {
          this.deleteFile(existingEntity);
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
        // DB 失败：若写出了不同于旧路径的新文件则补偿删除
        if (
          provisionalWritten &&
          existingEntity &&
          this.shouldDeleteOldFileAfterUpdate(existingEntity, provisionalWritten, oldSlug, newSlug)
        ) {
          try {
            this.deleteFile(provisionalWritten);
          } catch {
            /* compensate best-effort */
          }
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

  /** 默认：仅 slug 变化时删旧文件；Post 可覆盖以支持 garden 迁移 */
  protected shouldDeleteOldFileAfterUpdate(
    _existing: TEntity,
    _next: TEntity,
    oldSlug: string | null,
    newSlug: string,
  ): boolean {
    return Boolean(oldSlug && oldSlug !== newSlug);
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

/* ─── 2. 实体业务逻辑的具体 Service 实现 ─── */

/** GardenService 已拆至 infra/entityServices/gardenService.ts */

/** Post 文章 */
export interface PostEntity {
  id: string;
  title: string;
  garden: string;
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
  /** 默认花园目录名；实际读写走 getGardenDir(entity.garden) */
  readonly contentDirName = "posts";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.post; }

  protected formatEntity(raw: any): PostEntity {
    const garden = String(raw.garden ?? DEFAULT_POST_GARDEN);
    return {
      ...raw,
      garden,
      tags: raw.tags ? raw.tags.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  /** 解析花园根目录（content/{garden}） */
  protected getGardenDir(garden: string): string {
    if (!isValidGardenIdFormat(garden)) {
      throw new Error(`非法花园 id：${garden}`);
    }
    return resolveGardenDir(this.config, garden);
  }

  protected resolvePostFilePath(garden: string, slug: string): string {
    const safe = this.assertSafeFileSlug(slug);
    const contentRoot = path.resolve(this.getGardenDir(garden));
    const filePath = path.resolve(contentRoot, `${safe}${this.fileExtension}`);
    assertPathWithinProjectRoot(this.config, filePath);
    const prefix = contentRoot.endsWith(path.sep) ? contentRoot : contentRoot + path.sep;
    if (filePath !== contentRoot && !filePath.startsWith(prefix)) {
      throw new Error(`Post 文件路径越出花园 ${garden}：${slug}`);
    }
    return filePath;
  }

  protected override writeFile(entity: PostEntity): void {
    const filePath = this.resolvePostFilePath(entity.garden, entity.slug);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, this.serializeToFile(entity), "utf-8");
  }

  protected override deleteFile(entity: PostEntity): void {
    const filePath = this.resolvePostFilePath(entity.garden, entity.slug);
    if (!fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`删除 Post 文件失败（${filePath}）：${msg}`);
    }
  }

  protected override shouldDeleteOldFileAfterUpdate(
    existing: PostEntity,
    next: PostEntity,
    oldSlug: string | null,
    newSlug: string,
  ): boolean {
    if (!oldSlug) return false;
    return oldSlug !== newSlug || existing.garden !== next.garden;
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
    if (input.garden) where.garden = input.garden;
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
    const garden = input.garden ?? DEFAULT_POST_GARDEN;
    return {
      title: input.title,
      garden,
      slug,
      content: stripLeadingMarkdownFrontmatter(input.content ?? ""),
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
    if (typeof updateData.content === "string") {
      updateData.content = stripLeadingMarkdownFrontmatter(updateData.content);
    }
    if (tags !== undefined) updateData.tags = tags.join(",");
    return updateData;
  }

  protected override getListSelect(): any {
    // P1-7：列表不返回完整 content，载荷过大；需要正文走 getById。
    return {
      id: true,
      title: true,
      garden: true,
      slug: true,
      excerpt: true,
      coverImage: true,
      published: true,
      category: true,
      tags: true,
      viewCount: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  protected serializeToFile(entity: PostEntity): string {
    // garden 由目录表达，不写入 frontmatter（目录是事实源）
    // 正文禁止再夹一层 frontmatter，否则落盘双头、预览把 YAML 渲成列表
    const body = stripLeadingMarkdownFrontmatter(entity.content ?? "");
    const tagsYaml = entity.tags?.length > 0 ? `\ntags:\n` + entity.tags.map((t) => `  - "${t}"`).join("\n") : "";
    return `---
title: "${entity.title.replace(/"/g, '\\"')}"
category: ${entity.category ? `"${entity.category.replace(/"/g, '\\"')}"` : "null"}${tagsYaml}
published: ${entity.published}
excerpt: ${entity.excerpt ? `"${entity.excerpt.replace(/"/g, '\\"')}"` : "null"}
---
${body}
`;
  }

  protected getFileSlug(entity: PostEntity): string { return entity.slug; }

  // P11：FTS 增量——body 含 garden/slug/category/tags
  protected override async afterCreate(entity: PostEntity, input: CreatePostInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("post", entity.id, entity.title, buildPostFtsBody(entity));
  }
  protected override async afterUpdate(entity: PostEntity, existing: any, input: UpdatePostInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("post", entity.id, entity.title, buildPostFtsBody(entity));
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("post", existing.id);
  }

  /** (garden, slug) 联合唯一 */
  private async assertGardenSlugUnique(
    garden: string,
    slug: string,
    operation: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.post.findFirst({
      where: { garden, slug },
    });
    if (existing && existing.id !== excludeId) {
      throw new ServiceValidationError(
        failure({
          code: "POST_GARDEN_SLUG_CONFLICT",
          message: `${operation} post 失败：花园 ${garden} 下 slug "${slug}" 已被占用。`,
          details: { garden, slug, existingId: existing.id },
          field: "slug",
          suggestion: "换一个 slug，或改用其它花园。",
          retryable: false,
          operation,
          entity: this.entityName,
        }),
      );
    }
  }

  protected override async validateCreate(input: CreatePostInput): Promise<void> {
    const slug = input.slug || this.generateSlug(input.title);
    const garden = input.garden ?? DEFAULT_POST_GARDEN;
    await this.assertGardenExists(garden, "创建文章");
    await this.assertGardenSlugUnique(garden, slug, "创建");
  }

  protected override async validateUpdate(input: UpdatePostInput, existing: any): Promise<void> {
    const nextGarden = input.garden ?? existing.garden ?? DEFAULT_POST_GARDEN;
    const nextSlug = input.slug ?? existing.slug;
    if (nextGarden !== existing.garden) {
      await this.assertGardenExists(nextGarden, "更新文章");
    }
    if (nextGarden !== existing.garden || nextSlug !== existing.slug) {
      await this.assertGardenSlugUnique(nextGarden, nextSlug, "更新", input.id);
    }
  }

  private async assertGardenExists(garden: string, operation: string): Promise<void> {
    if (!isValidGardenIdFormat(garden) || isReservedContentDir(garden)) {
      throw new ServiceValidationError(
        failure({
          code: "POST_BAD_GARDEN",
          message: `${operation}失败：花园 id 非法或为保留名（${garden}）`,
          retryable: false,
          operation,
          entity: this.entityName,
        }),
      );
    }
    const row = await this.prisma.garden.findFirst({
      where: { id: garden, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new ServiceValidationError(
        failure({
          code: "POST_GARDEN_NOT_FOUND",
          message: `${operation}失败：花园 "${garden}" 不存在。请先创建花园`,
          suggestion: "调用 garden.create 或 native:garden_create",
          retryable: false,
          operation,
          entity: this.entityName,
        }),
      );
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, garden: existing.garden, slug: existing.slug, title: existing.title };
  }

  async getBySlug(slug: string, garden: string = DEFAULT_POST_GARDEN): Promise<PostEntity> {
    const post = await this.prisma.post.findFirst({
      where: { garden, slug, deletedAt: null },
    });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: `文章不存在（${garden}/${slug}）` });
    return this.formatEntity(post);
  }

  /** 浏览量 +1；与 getBySlug 分离，侧栏预取可安全缓存全文 */
  async recordView(id: string): Promise<{ viewCount: number }> {
    const existing = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: `文章不存在（id=${id}）` });
    }
    return this.prisma.post.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });
  }

  /**
   * 内链 hover 预览：不增加 viewCount，只返回标题/摘要/正文前段纯文本。
   */
  async preview(slug: string, garden: string = DEFAULT_POST_GARDEN): Promise<{
    id: string;
    garden: string;
    slug: string;
    title: string;
    excerpt: string | null;
    category: string | null;
    tags: string[];
    previewText: string;
  }> {
    const post = await this.prisma.post.findFirst({
      where: { garden, slug, deletedAt: null },
      select: {
        id: true,
        garden: true,
        slug: true,
        title: true,
        excerpt: true,
        category: true,
        tags: true,
        content: true,
      },
    });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: `文章不存在（${garden}/${slug}）` });

    const tags = post.tags
      ? post.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const excerpt = post.excerpt?.trim() || null;
    const previewText =
      excerpt ||
      String(post.content || "")
        .replace(/^---[\s\S]*?---\s*/, "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/\$\$[\s\S]*?\$\$/g, " ")
        .replace(/\$[^$\n]+\$/g, " ")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[#>*_`~|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);

    return {
      id: post.id,
      garden: post.garden,
      slug: post.slug,
      title: post.title,
      excerpt,
      category: post.category,
      tags,
      previewText,
    };
  }

  async search(query: string, limit = 10, garden?: string): Promise<PostEntity[]> {
    try {
      const ftsHits = await searchFts(this.prisma, query, limit * 2);
      const postIds = ftsHits.filter((h) => h.entity === "post").map((h) => h.entityId);
      if (postIds.length > 0) {
        const posts = await this.prisma.post.findMany({
          where: { id: { in: postIds }, deletedAt: null, ...(garden ? { garden } : {}) },
        });
        const byId = new Map(posts.map((p: any) => [p.id, p] as const));
        const ordered = postIds.map((id) => byId.get(id)).filter((p): p is any => !!p);
        if (ordered.length > 0) return ordered.slice(0, limit).map((item: any) => this.formatEntity(item));
      }
    } catch {
      // FTS 不可用（表未就绪等），回退 LIKE
    }
    const rawItems = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        ...(garden ? { garden } : {}),
        OR: [{ title: { contains: query } }, { content: { contains: query } }],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return rawItems.map((item: any) => this.formatEntity(item));
  }

  async tree(garden?: string): Promise<{ id: string; garden: string; slug: string; title: string }[]> {
    return this.prisma.post.findMany({
      where: { published: true, deletedAt: null, ...(garden ? { garden } : {}) },
      select: { id: true, garden: true, slug: true, title: true },
      orderBy: [{ garden: "asc" }, { slug: "asc" }],
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

  /**
   * 相关笔记完整打分：
   * - FTS（标题/正文/标签）BM25
   * - 标签交集
   * - 同花园 / 同分类
   * 排除自身与未发布/墓碑。
   */
  async related(input: RelatedPostsInput): Promise<
    Array<{
      id: string;
      title: string;
      slug: string;
      garden: string;
      excerpt: string | null;
      category: string | null;
      tags: string[];
      score: number;
      reasons: string[];
      updatedAt: Date;
    }>
  > {
    const limit = input.limit ?? 8;
    const self = await this.prisma.post.findUnique({ where: { id: input.id } });
    if (!self || self.deletedAt) {
      throw new TRPCError({ code: "NOT_FOUND", message: `related 失败：文章 ${input.id} 不存在` });
    }
    const selfTags = self.tags
      ? self.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    const titleTokens = self.title
      .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 10);
    const query = [...titleTokens, ...selfTags].join(" ").trim() || self.title;

    type Cand = {
      id: string;
      title: string;
      slug: string;
      garden: string;
      excerpt: string | null;
      category: string | null;
      tags: string;
      content: string | null;
      updatedAt: Date;
      published: boolean;
    };
    const byId = new Map<string, Cand>();
    const bump = (row: Cand) => {
      if (row.id === self.id) return;
      if (!byId.has(row.id)) byId.set(row.id, row);
    };

    try {
      const ftsHits = await searchFtsByEntity(this.prisma, "post", query, limit * 5);
      const ids = ftsHits.map((h) => h.entityId).filter((id) => id !== self.id);
      if (ids.length > 0) {
        const rows = await this.prisma.post.findMany({
          where: { id: { in: ids }, deletedAt: null, published: true },
        });
        for (const r of rows) bump(r as Cand);
      }
    } catch {
      /* FTS 不可用则只靠标签/分类 */
    }

    for (const tag of selfTags.slice(0, 8)) {
      const rows = await this.prisma.post.findMany({
        where: {
          deletedAt: null,
          published: true,
          id: { not: self.id },
          tags: { contains: tag },
        },
        take: 30,
      });
      for (const r of rows) bump(r as Cand);
    }

    if (self.category) {
      const rows = await this.prisma.post.findMany({
        where: {
          deletedAt: null,
          published: true,
          id: { not: self.id },
          category: self.category,
        },
        take: 30,
        orderBy: { updatedAt: "desc" },
      });
      for (const r of rows) bump(r as Cand);
    }

    // 同花园近邻兜底
    const gardenRows = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        published: true,
        id: { not: self.id },
        garden: self.garden,
      },
      take: 40,
      orderBy: { updatedAt: "desc" },
    });
    for (const r of gardenRows) bump(r as Cand);

    let ftsRankById = new Map<string, number>();
    try {
      const ftsHits = await searchFtsByEntity(this.prisma, "post", query, limit * 5);
      ftsHits.forEach((h, i) => {
        // BM25 越小越好；转成正分：靠前加分
        const bm25 = typeof h.rank === "number" ? h.rank : -i;
        ftsRankById.set(h.entityId, Math.max(0, 40 + bm25 * -2) + Math.max(0, 20 - i));
      });
    } catch {
      ftsRankById = new Map();
    }

    const scored = Array.from(byId.values()).map((row) => {
      const tags = row.tags
        ? row.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const overlap = selfTags.filter((t) => tags.includes(t));
      const reasons: string[] = [];
      let score = 0;

      const ftsScore = ftsRankById.get(row.id) ?? 0;
      if (ftsScore > 0) {
        score += ftsScore;
        reasons.push("全文相关");
      }
      if (overlap.length > 0) {
        score += overlap.length * 18;
        reasons.push(`标签重合：${overlap.slice(0, 4).join("、")}`);
      }
      if (row.garden === self.garden) {
        score += 12;
        reasons.push("同花园");
      }
      if (self.category && row.category === self.category) {
        score += 14;
        reasons.push(`同分类：${self.category}`);
      }
      // 标题子串轻量加分
      const titleHit = titleTokens.some(
        (t) => t.length >= 2 && row.title.toLowerCase().includes(t.toLowerCase()),
      );
      if (titleHit) {
        score += 10;
        reasons.push("标题相近");
      }
      // 新鲜度轻微加成（30 天内）
      const ageDays = (Date.now() - new Date(row.updatedAt).getTime()) / 86400000;
      if (ageDays < 30) score += Math.max(0, 6 - ageDays / 5);

      const excerpt =
        row.excerpt ||
        (row.content ? row.content.replace(/\s+/g, " ").trim().slice(0, 140) : null);

      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        garden: row.garden,
        excerpt,
        category: row.category,
        tags,
        score: Math.round(score * 10) / 10,
        reasons: reasons.length ? reasons : ["邻近文章"],
        updatedAt: row.updatedAt,
      };
    });

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Chat 消息 → 文章落库（create / update / append）。
   * 正文只信服务端 ChatMessage，且须属于给定 session。
   */
  async createFromChat(input: CreatePostFromChatInput): Promise<OperationResult<PostEntity>> {
    try {
      const msg = await this.prisma.chatMessage.findFirst({
        where: { id: input.messageId, sessionId: input.sessionId },
      });
      if (!msg) {
        throw new ServiceValidationError(
          failure({
            code: "CHAT_MESSAGE_NOT_FOUND",
            message: `createFromChat 失败：会话 ${input.sessionId} 中找不到消息 ${input.messageId}`,
            details: { sessionId: input.sessionId, messageId: input.messageId },
            suggestion: "刷新会话后重试，或换一条消息。",
            retryable: false,
            operation: "createFromChat",
            entity: "post",
          }),
        );
      }
      const body = (msg.content || "").trim();
      if (!body) {
        throw new ServiceValidationError(
          failure({
            code: "CHAT_MESSAGE_EMPTY",
            message: "createFromChat 失败：消息正文为空，无法落库。",
            retryable: false,
            operation: "createFromChat",
            entity: "post",
          }),
        );
      }

      const mode = input.mode ?? "create";
      if (mode === "create") {
        const title =
          input.title?.trim() ||
          body
            .split("\n")
            .map((l) => l.replace(/^#+\s*/, "").trim())
            .find((l) => l.length > 0)
            ?.slice(0, 80) ||
          `来自对话 ${new Date().toLocaleString("zh-CN")}`;
        return this.create({
          title,
          content: body,
          garden: input.garden,
          category: input.category ?? null,
          tags: input.tags,
          published: input.published ?? true,
          excerpt: body.replace(/\s+/g, " ").trim().slice(0, 160),
        });
      }

      if (!input.targetPostId) {
        throw new ServiceValidationError(
          failure({
            code: "TARGET_POST_REQUIRED",
            message: `createFromChat 失败：mode=${mode} 时必须提供 targetPostId。`,
            field: "targetPostId",
            retryable: false,
            operation: "createFromChat",
            entity: "post",
          }),
        );
      }

      const target = await this.getById(input.targetPostId);
      if (mode === "update") {
        return this.update({
          id: target.id,
          content: body,
          title: input.title?.trim() || undefined,
          category: input.category === undefined ? undefined : input.category,
          tags: input.tags,
          published: input.published,
        });
      }

      // append
      const heading = input.appendHeading?.trim();
      const block = heading
        ? `\n\n## ${heading}\n\n${body}\n`
        : `\n\n---\n\n${body}\n`;
      const nextContent = `${target.content || ""}${block}`;
      return this.update({
        id: target.id,
        content: nextContent,
        title: input.title?.trim() || undefined,
        category: input.category === undefined ? undefined : input.category,
        tags: input.tags,
        published: input.published,
      });
    } catch (error: any) {
      if (error instanceof ServiceValidationError || error instanceof TRPCError) throw error;
      return failureFromError(error, "createFromChat", "post", "POST_FROM_CHAT_FAILED");
    }
  }

  async getById(id: string): Promise<PostEntity> {
    const raw = await this.delegate.findUnique({ where: { id, deletedAt: null } });
    if (!raw) throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
    return this.formatEntity(raw);
  }

  private getTrashDir(garden: string): string {
    return path.join(this.getGardenDir(garden), ".trash");
  }

  private moveFileToTrash(garden: string, slug: string): void {
    const dir = this.getGardenDir(garden);
    const trashDir = this.getTrashDir(garden);
    const src = path.join(dir, `${slug}${this.fileExtension}`);
    const dest = path.join(trashDir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
    }
  }

  private moveFileFromTrash(garden: string, slug: string): void {
    const dir = this.getGardenDir(garden);
    const trashDir = this.getTrashDir(garden);
    const src = path.join(trashDir, `${slug}${this.fileExtension}`);
    const dest = path.join(dir, `${slug}${this.fileExtension}`);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
    }
  }

  private deleteFileFromTrash(garden: string, slug: string): void {
    const trashDir = this.getTrashDir(garden);
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
      const garden = String(existing.garden ?? DEFAULT_POST_GARDEN);
      if (slug) this.moveFileToTrash(garden, slug);
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
      const garden = String(existing.garden ?? DEFAULT_POST_GARDEN);
      if (slug) this.moveFileFromTrash(garden, slug);
      const raw = await this.delegate.update({ where: { id }, data: { deletedAt: null } });
      const entity = this.formatEntity(raw);
      // #11：恢复后重新入 FTS，使文章可被搜索
      await this.syncFts(
        "post",
        entity.id,
        entity.title,
        `[${entity.garden}] ${entity.slug}\n${entity.content ?? ""}`,
      );
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
      const garden = String(existing.garden ?? DEFAULT_POST_GARDEN);
      if (slug) this.deleteFileFromTrash(garden, slug);
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
    const { ...rest } = raw;
    return {
      ...rest,
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
      ...(input.heartbeatModel !== undefined ? { heartbeatModel: input.heartbeatModel } : {}),
      ...(input.heartbeat !== undefined ? { heartbeat: input.heartbeat } : {}),
    };
  }

  protected buildUpdateData(input: UpdateAgentInput): any {
    const { id: _id, tools, name, tier, workspaceId, parentId, source, heartbeatModel, heartbeat, status, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name;
    if (tools !== undefined) updateData.tools = materializeAgentTools(tools).join(",");
    if (tier !== undefined) updateData.tier = tier;
    if (workspaceId !== undefined) updateData.workspaceId = workspaceId;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (source !== undefined) updateData.source = source;
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
    const { notifyAllMainSessionsUi } = await import("./infra/uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "agent_list_changed",
      agentId: entity.id,
      reason: "create",
    });
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
    const { notifyAllMainSessionsUi } = await import("./infra/uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "agent_list_changed",
      agentId: existing.id,
      reason: "delete",
    });
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
          // W2：配置变更同时清零决策 terminal/退避态，供 refresh 摘除 suspended
          input = {
            ...input,
            heartbeat: {
              ...base,
              consecutiveFailures: 0,
              decision: {
                skipRemaining: 0,
                resetToken: "",
                lastMode: null,
                quietStreak: 0,
                lastSkipTicks: 0,
                lastGateNotifyAt: null,
                lastGateNotifyKey: null,
                terminalAt: null,
              },
            },
          };
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

/** SkillService 已拆至 infra/entityServices/skillService.ts */

/** McpService 已拆至 infra/entityServices/mcpService.ts */

/** MemoryService 已拆至 infra/entityServices/memoryService.ts */

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
  rotatedFromSessionId?: string | null;
  /** 会话级待办清单（todo_write / todo_read） */
  todoState?: unknown | null;
  /** 会话树当前叶消息 id */
  activeLeafId?: string | null;
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
    // 显式 kind=skill_review|heartbeat 走旁路入口（listSideRuns 等）；
    // 对话历史默认排除，避免系统旁路会话污染侧栏。
    if (input.kind) where.kind = input.kind;
    else where.kind = { notIn: ["skill_review", "heartbeat"] };
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

  protected override async afterCreate(entity: SessionEntity, input: CreateSessionInput): Promise<void> {
    await super.afterCreate(entity, input);
    if (!entity.agentId) return;
    const { notifyAgentUi } = await import("./infra/uiStateNotify.js");
    await notifyAgentUi(this.prisma, entity.agentId, {
      type: "session_list_changed",
      agentId: entity.agentId,
      sessionId: entity.id,
      reason: "create",
    });
  }

  /**
   * 列表可见字段变更才推（status/title/血缘等）。
   * 跳过 contextSummary / goalState / todoState 等高频写，避免 SSE 风暴。
   */
  protected override async afterUpdate(
    entity: SessionEntity,
    existing: any,
    input: UpdateSessionInput,
  ): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    const agentId = entity.agentId ?? existing?.agentId;
    if (!agentId) return;
    const listAffecting =
      input.status !== undefined ||
      input.title !== undefined ||
      input.autoName !== undefined ||
      input.kind !== undefined ||
      input.parentSessionId !== undefined ||
      input.isMainSession !== undefined ||
      input.rotatedToSessionId !== undefined ||
      input.rotatedFromSessionId !== undefined ||
      input.agentId !== undefined;
    if (!listAffecting) return;
    const { notifyAgentUi } = await import("./infra/uiStateNotify.js");
    await notifyAgentUi(this.prisma, agentId, {
      type: "session_list_changed",
      agentId,
      sessionId: entity.id,
      reason: "update",
    });
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    if (!existing?.agentId) return;
    const { notifyAgentUi } = await import("./infra/uiStateNotify.js");
    await notifyAgentUi(this.prisma, existing.agentId, {
      type: "session_list_changed",
      agentId: existing.agentId,
      sessionId: existing.id,
      reason: "delete",
    });
  }

  /**
   * P11 不变量：每 Agent 至多一条 isMainSession=true（与 ensureMainSession 同源）。
   * 新建/提升主会话前摘掉同 Agent 其它主会话标记，避免 prepareAgentRun findFirst
   * 命中「空壳主会话」而测试/业务占用的是另一条 isMainSession 会话。
   */
  private async demoteOtherMainSessions(agentId: string, exceptId?: string): Promise<void> {
    await this.prisma.chatSession.updateMany({
      where: {
        agentId,
        isMainSession: true,
        status: { not: "deleted" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isMainSession: false },
    });
  }

  override async create(input: CreateSessionInput): Promise<OperationResult<SessionEntity>> {
    if (input.isMainSession && input.agentId) {
      await this.demoteOtherMainSessions(input.agentId);
    }
    return super.create(input);
  }

  override async update(input: UpdateSessionInput): Promise<OperationResult<SessionEntity>> {
    if (input.isMainSession === true) {
      const existing = await this.prisma.chatSession.findUnique({
        where: { id: input.id },
        select: { agentId: true },
      });
      if (existing?.agentId) {
        await this.demoteOtherMainSessions(existing.agentId, input.id);
      }
    }
    return super.update(input);
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
   * 2. resume 互斥点 = 条件写 updateMany where {id, status:"paused"} → {status:"running"}：
   *    count=1 获得恢复权；count=0 重读——已 running → 幂等返回（并发 double-resume
   *    落选方不报错、不重复起流）；其它 → BAD_REQUEST。
   *    普通发消息走 Hub.start 的 claim（active|paused→running），与此处幂等叠加。
   * 3. 系统提示消息（role:"user", source:"system"）由 chatAgentStream 在起流后写入——
   *    注入与起流同源，不存在「消息已写、流未起」的孤儿窗口，故回滚无需删消息。
   * 4. 起流失败回滚（宁漏勿错）：startIfNotRunning 返回 false = 已有活跃流接管
   *    （竞态幂等，状态维持 running，不算失败）；抛错 → 条件写回滚 running→paused。
   *    可判定依据：hub.start 的全部抛错点都在 runs 占位与 runner 执行之前
   *    （isRunning 检查；maxEventIdFor 内部已吞错不抛），抛错 ⟹ runner 未执行
   *    ⟹ 消息必然未写入 ⟹ 回滚安全完整。回滚同走条件写 where status:"running"：
   *    期间已被 stop/接管则 count=0 不误滚。
   * 5. 终态归位收进 SessionStreamHub.start（所有起流路径共用）：run 结束时若仍 running——
   *    done → subagent/skill_review "completed" / 其它 "active"；error/中断 → "paused"。
   *    resume 不再重复 settle；条件写 where status:"running" 保证与 stop/report_back 不覆盖。
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
      drainPromise
        .finally(async () => {
          if (hub.isRunning(input.id)) return;
          // 与 Hub.settleSessionDbStatus 对齐：subagent / skill_review → completed
          const nextStatus =
            session.kind === "subagent" || session.kind === "skill_review" ? "completed" : "active";
          await this.prisma.chatSession
            .updateMany({
              where: { id: input.id, status: "running" },
              data: { status: nextStatus },
            })
            .catch((settleErr) => {
              console.warn(`[session.resume] superior drain 后归位失败 session=${input.id}:`, settleErr);
            });
        })
        .catch((err) => {
          console.warn(`[session.resume] superior drain 链失败 session=${input.id}:`, err instanceof Error ? err.message : err);
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
    // 用户软暂停（assistant finishReason=aborted）与重启尸体会话分叉提示
    let continueHint = "（服务已重启，请继续完成未完成的任务）";
    if (!orphanAnswer && !askHint) {
      const lastAssistant = await this.prisma.chatMessage.findFirst({
        where: { sessionId: input.id, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { finishReason: true },
      });
      if (lastAssistant?.finishReason === "aborted") {
        continueHint =
          "（用户暂停了生成，请根据已有对话与工具结果，从中断处继续完成任务）";
      }
    }
    const body: AgentChatInput = {
      sessionId: input.id,
      agentId: session.agentId ?? undefined,
      message: orphanAnswer?.content ?? askHint ?? continueHint,
      // 孤儿答复按用户消息上链；其余恢复注入走 system 去重路径
      source: orphanAnswer ? "user" : "system",
      // 子任务血统允许 report_back（与 asyncJobManager autoConsume 同口径）
      runOrigin: session.parentSessionId || session.kind === "subagent" ? "parent" : "user",
    };

    const { createTrpcInvoker } = await import("./infra/trpcInvoker.js");
    const invokeTrpc = createTrpcInvoker({ services });
    const { chatAgentStream } = await import("./infra/agentStream.js");
    type AgentStreamEvent = import("./infra/agentStream.js").AgentStreamEvent;

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
        // B2：孤儿 ask_user 答复已写入 ChatMessage 后才 finalize 删行；失败保留 claimedAt 交恢复
        if (orphanAnswer && track.terminal === "done") {
          await services.sessionQueueItem.finalize(orphanAnswer.id).catch((finErr) => {
            console.warn(`[session.resume] finalize ask_user 队列项失败 item=${orphanAnswer.id}:`, finErr);
          });
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

      if (started !== "started") {
        // 已有活跃流接管（busy/duplicate）：竞态幂等，状态维持 running
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
    await this.prisma.sessionStreamEvent.deleteMany({}).catch((err) => {
      console.warn("[session.deleteMany] streamEvent 清空失败:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });
    await this.prisma.task.deleteMany({
      where: { OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }] },
    }).catch((err) => {
      console.warn("[session.deleteMany] async task 清空失败:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });
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
      const warnClear = (sid: string) => (err: unknown) => {
        console.warn(`[session.delete] hub.clear 失败 session=${sid}:`, err instanceof Error ? err.message : err);
      };
      for (const child of children) {
        hub?.stop(child.id);
        await hub?.clear(child.id).catch(warnClear(child.id));
      }
      hub?.stop(id);
      await hub?.clear(id).catch(warnClear(id));
    } catch {
      /* StreamHub 未初始化，忽略 */
    }
    const warnCascade = (label: string, sid: string) => (err: unknown) => {
      console.warn(`[session.delete] ${label} 失败 session=${sid}:`, err instanceof Error ? err.message : err);
    };
    for (const child of children) {
      await this.prisma.task.deleteMany({ where: { sessionId: child.id } }).catch(warnCascade("task", child.id));
      await this.prisma.sessionStreamEvent
        .deleteMany({ where: { sessionId: child.id } })
        .catch(warnCascade("streamEvent", child.id));
      await super.delete(child.id);
    }
    await this.prisma.task.deleteMany({ where: { sessionId: id } }).catch(warnCascade("task", id));
    await this.prisma.sessionStreamEvent
      .deleteMany({ where: { sessionId: id } })
      .catch(warnCascade("streamEvent", id));
    return super.delete(id);
  }

  protected override getCreateNextSteps(entity: SessionEntity): NextStep[] {
    return [{ action: "进入会话发送消息", procedure: "message.create", input: { sessionId: entity.id }, reason: "新会话已创建，可开始对话。" }];
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, title: existing.title };
  }
}

/** MessageService 已拆至 infra/entityServices/messageService.ts */


/** SessionQueueItemService 已拆至 infra/entityServices/sessionQueueItemService.ts */


/** FileService 已拆至 infra/entityServices/fileService.ts */

/** LogService 已拆至 infra/entityServices/logService.ts */

/** GitService 已拆至 infra/entityServices/gitService.ts */

/** TaskService 已拆至 infra/entityServices/taskService.ts */

/** WorkspaceService 已拆至 infra/entityServices/workspaceService.ts */

/** TriggerService 已拆至 infra/entityServices/triggerService.ts */

/** ApprovalService 已拆至 infra/entityServices/approvalService.ts */

/** ToolService 已拆至 infra/entityServices/toolService.ts */

/** RunService 已拆至 infra/entityServices/runService.ts */
/** PromptService 已拆至 infra/entityServices/promptService.ts */
/** CredentialService 已拆至 infra/entityServices/credentialService.ts */

/** InfoSourceService 已拆至 infra/entityServices/infoSourceService.ts */

/** InboxService 已拆至 infra/entityServices/inboxService.ts */
