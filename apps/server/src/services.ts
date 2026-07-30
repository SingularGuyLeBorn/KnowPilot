/**
 * KnowPilot 后端服务业务层基座 (Services Layer)
 *
 * 【扁平化 + 按需叶子拆分】：
 * 1. 本文件只保留 Service 错误定义、CRUD 基类 BaseService / FileSyncService 与辅助函数。
 * 2. 全部实体 Service 在 `infra/entityServices/`，由 serviceContainer 直连叶子，禁止兼容 re-export。
 * 3. 禁止平行 `services/` 子目录树。
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
} from "@knowpilot/shared";
import { success, failure, failureFromError } from "./trpc/result.js";
import type { AppEventBus } from "./infra/eventBus.js";
import type { AppConfig } from "./infra/config.js";
import { upsertFtsRow, deleteFtsRow } from "./infra/ftsIndex.js";
import { assertPathWithinProjectRoot } from "./infra/safePath.js";

/* ─── 1. 辅助类型与基类 ─── */

/** Post FTS body：含 garden/slug/category/tags，供相关推荐与全局搜索命中标签 */
export function buildPostFtsBody(entity: {
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
export function newEntityId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

/** 安全 JSON.parse：失败时返回 null 并 warn，避免坏数据致 list 整体崩溃。 */
export function safeJsonParse(raw: string): Record<string, unknown> | null {
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
/** PostService 已拆至 infra/entityServices/postService.ts */

/** AgentService 已拆至 infra/entityServices/agentService.ts */

/** SessionService 已拆至 infra/entityServices/sessionService.ts */

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
