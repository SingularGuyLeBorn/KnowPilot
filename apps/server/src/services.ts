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
  type RelatedPostsInput,
  type CreatePostFromChatInput,
  type CreateGardenInput,
  type UpdateGardenInput,
  type ListGardensInput,
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
  type CreateInboxItemInput,
  type UpdateInboxItemInput,
  type ListInboxItemsInput,
  type InboxCaptureUrlInput,
  type InboxCaptureUrlsInput,
  type InboxSyncZhihuInput,
  inboxSyncZhihuSchema,
  inboxSyncXhsSchema,
  inboxSyncBilibiliSchema,
  inboxPlatformSyncStartSchema,
  type InboxSyncXhsInput,
  type InboxSyncBilibiliInput,
  type InboxPlatformSyncStartInput,
  type InboxScanScreenshotsInput,
  type InboxIngestWechatDropInput,
  type InboxDistillInput,
  type InboxIgnoreInput,
  type InboxEnrichInput,
  inboxEnrichSchema,
  type AgentRunInput,
  type AgentChatInput,
  type WebSearchInput,
  type GitRepoPathInput,
  type NativeExecuteInput,
  DEFAULT_POST_GARDEN,
  SEED_GARDENS,
  isValidGardenIdFormat,
  isReservedContentDir,
} from "@knowpilot/shared";
import { success, failure, failureFromError } from "./trpc/result.js";
import type { AppEventBus } from "./infra/eventBus.js";
import type { AppConfig } from "./infra/config.js";
import { resolveGardenDir, resolveGardenMetaPath } from "./infra/config.js";
import { serializeGardenFile } from "./scripts/sync/sync-gardens.js";
import { stripLeadingMarkdownFrontmatter } from "./scripts/sync/utils.js";
import matter from "gray-matter";
// type-only：编译期擦除，不构成运行时循环依赖（resume 的 runner emit 追踪用）
import { notifyApprovalResolved } from "./infra/approvalGate.js";
import { deriveDecisionScope } from "./infra/approvalScope.js";
import { encryptCredentialValue, decryptCredentialValue, maskSecret, invalidateIntegrationCredentials } from "./infra/credentialVault.js";
import { upsertFtsRow, deleteFtsRow, searchFts, searchFtsByEntity } from "./infra/ftsIndex.js";
import { invalidateCapabilitiesCache } from "./infra/capabilities.js";
import { resolveSafePath, assertPathWithinProjectRoot } from "./infra/safePath.js";
import { parseSkillKind, skillFileSlug } from "./infra/skillPackage.js";
import { claimTaskRun } from "./infra/taskClaim.js";

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

const SEED_GARDEN_META: Record<string, { title: string; description: string; home: string }> = {
  posts: {
    title: "博客",
    description: "对外博客与长文",
    home: "# 博客\n\n这里是博客花园首页。用 post_create（garden=posts）写文章。\n",
  },
  knowledge: {
    title: "知识库",
    description: "内部笔记与知识整理",
    home: "# 知识库\n\n这里是知识库花园首页。\n",
  },
  resources: {
    title: "资源",
    description: "资料索引与素材清单",
    home: "# 资源\n\n这里是资源花园首页。\n",
  },
};

/** Garden 知识库 */
export interface GardenEntity {
  id: string;
  title: string;
  description: string | null;
  homeContent: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  postCount?: number;
  recentPosts?: Array<{ title: string; slug: string }>;
}

export class GardenService extends BaseService<
  CreateGardenInput,
  UpdateGardenInput,
  ListGardensInput,
  GardenEntity
> {
  readonly entityName = "garden";
  protected get delegate() {
    return this.prisma.garden;
  }

  protected formatEntity(raw: any): GardenEntity {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description ?? null,
      homeContent: raw.homeContent ?? "",
      deletedAt: raw.deletedAt ?? null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  protected buildListWhere(input: ListGardensInput): any {
    const where: any = { deletedAt: null };
    if (input.keyword) {
      where.OR = [
        { id: { contains: input.keyword } },
        { title: { contains: input.keyword } },
        { description: { contains: input.keyword } },
      ];
    }
    return where;
  }

  protected buildCreateData(input: CreateGardenInput): any {
    return {
      id: input.id,
      title: input.title,
      description: input.description ?? null,
      homeContent: input.homeContent ?? "",
    };
  }

  protected buildUpdateData(input: UpdateGardenInput): any {
    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.homeContent !== undefined) data.homeContent = input.homeContent;
    return data;
  }

  /** 花园是否存在且未软删 */
  async existsActive(id: string): Promise<boolean> {
    if (!isValidGardenIdFormat(id)) return false;
    const row = await this.prisma.garden.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return !!row;
  }

  async assertGardenActive(id: string, operation: string): Promise<void> {
    if (!isValidGardenIdFormat(id) || isReservedContentDir(id)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${operation} 失败：花园 id 非法或为保留名（about/uploads）`,
      });
    }
    if (!(await this.existsActive(id))) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `${operation} 失败：花园 "${id}" 不存在。请先 garden.create / garden_create`,
      });
    }
  }

  private writeMetaFile(entity: GardenEntity): void {
    const dir = resolveGardenDir(this.config, entity.id);
    const filePath = resolveGardenMetaPath(this.config, entity.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      filePath,
      serializeGardenFile({
        title: entity.title,
        description: entity.description,
        homeContent: entity.homeContent,
      }),
      "utf-8",
    );
  }

  protected override async validateCreate(input: CreateGardenInput): Promise<void> {
    if (!isValidGardenIdFormat(input.id) || isReservedContentDir(input.id)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `创建花园失败：id "${input.id}" 非法或为保留名`,
      });
    }
    const existing = await this.prisma.garden.findUnique({ where: { id: input.id } });
    if (existing && !existing.deletedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `创建花园失败：id "${input.id}" 已存在`,
      });
    }
  }

  override async create(input: CreateGardenInput): Promise<OperationResult<GardenEntity>> {
    const start = Date.now();
    try {
      await this.validateCreate(input);
      const soft = await this.prisma.garden.findUnique({ where: { id: input.id } });
      let entity: GardenEntity;
      if (soft?.deletedAt) {
        const updated = await this.prisma.garden.update({
          where: { id: input.id },
          data: {
            title: input.title,
            description: input.description ?? null,
            homeContent: input.homeContent ?? "",
            deletedAt: null,
          },
        });
        entity = this.formatEntity(updated);
      } else {
        const created = await this.prisma.garden.create({
          data: this.buildCreateData(input),
        });
        entity = this.formatEntity(created);
      }
      this.writeMetaFile(entity);
      return success({
        data: entity,
        operation: "create",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof TRPCError) throw e;
      if (e instanceof ServiceValidationError) return e.result;
      return failureFromError(e, "create", this.entityName, "GARDEN_CREATE_FAILED");
    }
  }

  override async update(input: UpdateGardenInput): Promise<OperationResult<GardenEntity>> {
    const start = Date.now();
    try {
      const existing = await this.prisma.garden.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `花园不存在：${input.id}` });
      }
      const updated = await this.prisma.garden.update({
        where: { id: input.id },
        data: this.buildUpdateData(input),
      });
      const entity = this.formatEntity(updated);
      this.writeMetaFile(entity);
      return success({
        data: entity,
        operation: "update",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof TRPCError) throw e;
      return failureFromError(e, "update", this.entityName, "GARDEN_UPDATE_FAILED");
    }
  }

  override async getById(id: string): Promise<GardenEntity> {
    const raw = await this.prisma.garden.findFirst({ where: { id, deletedAt: null } });
    if (!raw) throw new TRPCError({ code: "NOT_FOUND", message: `花园不存在：${id}` });
    return this.formatEntity(raw);
  }

  /** list 附带 postCount + 最近 3 篇标题，供知识库门户卡片 */
  override async list(input: ListGardensInput): Promise<PaginatedResult<GardenEntity>> {
    const result = await super.list(input);
    const ids = result.items.map((g) => g.id);
    if (ids.length === 0) return result;

    const [counts, ...previewBatches] = await Promise.all([
      this.prisma.post.groupBy({
        by: ["garden"],
        where: { garden: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      ...ids.map((gardenId) =>
        this.prisma.post.findMany({
          where: { garden: gardenId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: { title: true, slug: true },
        }),
      ),
    ]);

    const countMap = new Map(counts.map((c) => [c.garden, c._count._all]));
    return {
      ...result,
      items: result.items.map((g, i) => ({
        ...g,
        postCount: countMap.get(g.id) ?? 0,
        recentPosts: previewBatches[i] ?? [],
      })),
    };
  }

  /**
   * 删除空库：无未软删 Post 才可删。
   * 目录移到 content/.trash/gardens/{id}/，Garden 标 deletedAt。
   */
  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.prisma.garden.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) {
        return failure({
          code: "GARDEN_NOT_FOUND",
          message: `花园不存在：${id}`,
          operation: "delete",
          entity: this.entityName,
        });
      }
      if ((SEED_GARDENS as readonly string[]).includes(id)) {
        return failure({
          code: "GARDEN_SEED_PROTECTED",
          message: `不能删除种子花园 "${id}"`,
          operation: "delete",
          entity: this.entityName,
        });
      }
      const livePosts = await this.prisma.post.count({
        where: { garden: id, deletedAt: null },
      });
      if (livePosts > 0) {
        return failure({
          code: "GARDEN_NOT_EMPTY",
          message: `删除花园失败：仍有 ${livePosts} 篇未删文章。请先清空或移走文章`,
          operation: "delete",
          entity: this.entityName,
        });
      }
      const srcDir = resolveGardenDir(this.config, id);
      const trashRoot = path.join(this.config.contentDir, ".trash", "gardens");
      const trashDir = path.join(trashRoot, `${id}-${Date.now().toString(36)}`);
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(trashRoot, { recursive: true });
        fs.renameSync(srcDir, trashDir);
      }
      await this.prisma.garden.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return success({
        data: { id, title: existing.title, trashPath: fs.existsSync(trashDir) ? path.relative(this.config.projectRoot, trashDir).replace(/\\/g, "/") : null },
        operation: "delete",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      return failureFromError(e, "delete", this.entityName, "GARDEN_DELETE_FAILED");
    }
  }

  /**
   * 从 content/.trash/gardens/{id}-* 恢复软删花园。
   * 取最新一份 trash 目录移回 content/{id}/，清除 deletedAt。
   */
  async restore(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.prisma.garden.findFirst({ where: { id } });
      if (!existing) {
        return failure({
          code: "GARDEN_NOT_FOUND",
          message: `花园不存在：${id}`,
          operation: "restore",
          entity: this.entityName,
        });
      }
      if (!existing.deletedAt) {
        return failure({
          code: "GARDEN_NOT_DELETED",
          message: `花园未处于软删状态：${id}`,
          operation: "restore",
          entity: this.entityName,
        });
      }
      const destDir = resolveGardenDir(this.config, id);
      if (fs.existsSync(destDir)) {
        return failure({
          code: "GARDEN_DEST_EXISTS",
          message: `恢复失败：目标目录已存在 content/${id}/，请先手动处理`,
          operation: "restore",
          entity: this.entityName,
        });
      }
      const trashRoot = path.join(this.config.contentDir, ".trash", "gardens");
      let trashDir: string | null = null;
      if (fs.existsSync(trashRoot)) {
        const candidates = fs
          .readdirSync(trashRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory() && (e.name === id || e.name.startsWith(`${id}-`)))
          .map((e) => path.join(trashRoot, e.name))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        trashDir = candidates[0] ?? null;
      }
      if (!trashDir || !fs.existsSync(trashDir)) {
        return failure({
          code: "GARDEN_TRASH_MISSING",
          message: `回收站中找不到花园目录：${id}（content/.trash/gardens/${id}-*）`,
          operation: "restore",
          entity: this.entityName,
        });
      }
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      fs.renameSync(trashDir, destDir);
      await this.prisma.garden.update({
        where: { id },
        data: { deletedAt: null },
      });
      return success({
        data: {
          id,
          title: existing.title,
          path: `content/${id}/`,
          restoredFrom: path.relative(this.config.projectRoot, trashDir).replace(/\\/g, "/"),
        },
        operation: "restore",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      return failureFromError(e, "restore", this.entityName, "GARDEN_RESTORE_FAILED");
    }
  }

  /** 确保种子三库有目录、_garden.md 与 DB 行 */
  async ensureSeedGardens(): Promise<void> {
    for (const id of SEED_GARDENS) {
      const meta = SEED_GARDEN_META[id] ?? {
        title: id,
        description: "",
        home: `# ${id}\n`,
      };
      const dir = resolveGardenDir(this.config, id);
      const filePath = resolveGardenMetaPath(this.config, id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(
          filePath,
          serializeGardenFile({
            title: meta.title,
            description: meta.description,
            homeContent: meta.home,
          }),
          "utf-8",
        );
      }
      let title = meta.title;
      let description: string | null = meta.description || null;
      let homeContent = meta.home;
      if (fs.existsSync(filePath)) {
        try {
          const parsed = matter(fs.readFileSync(filePath, "utf-8"));
          if (typeof parsed.data.title === "string") title = parsed.data.title;
          if (typeof parsed.data.description === "string") description = parsed.data.description;
          homeContent = parsed.content.replace(/^\uFEFF/, "");
        } catch {
          /* keep defaults */
        }
      }
      await this.prisma.garden.upsert({
        where: { id },
        update: { title, description, homeContent, deletedAt: null },
        create: { id, title, description, homeContent },
      });
    }
  }
}

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
  lastAccessedAt?: Date | null;
  accessCount?: number;
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

  /** D8：MemoryRepository supersede 事务外文件先行 / 失败补偿 */
  writeContentFile(entity: MemoryEntity): void {
    this.writeFile(entity);
  }

  /** D8：事务失败时补偿删文件 */
  deleteContentFile(entity: MemoryEntity): void {
    try {
      this.deleteFile(entity);
    } catch (e) {
      console.warn(`[MemoryService] 补偿删文件失败 id=${entity.id}:`, e instanceof Error ? e.message : e);
    }
  }

  /** D8：事务成功后补 FTS / sourceMeta */
  async finalizeContentProjection(entity: MemoryEntity): Promise<void> {
    await this.syncFileMetaToDb(entity);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }

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
        .catch(() => {});
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
  parentId?: string | null;
  label?: string | null;
  kind?: string | null;
  attachments: any;
  toolCalls: any;
  toolResults: any;
  tokenUsage: any;
  finishReason?: string | null;
  source?: string;
  createdAt: Date;
}

function messageUpsertPayload(entity: MessageEntity) {
  return {
    id: entity.id,
    role: entity.role,
    content: entity.content,
    parentId: entity.parentId ?? null,
    label: entity.label ?? null,
    kind: entity.kind ?? null,
    toolCalls: entity.toolCalls ?? undefined,
    toolResults: entity.toolResults ?? undefined,
    tokenUsage: entity.tokenUsage ?? undefined,
    attachments: entity.attachments ?? undefined,
    source: entity.source ?? null,
    createdAt: entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
  };
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

  /**
   * W1：消息 create + activeLeafId 推进必须同事务（appendChatMessage）。
   * 禁止走裸 delegate.create，否则会话树断链。
   */
  override async create(input: CreateMessageInput): Promise<OperationResult<MessageEntity>> {
    const start = Date.now();
    try {
      await this.validateCreate(input);
      const { appendChatMessage } = await import("./infra/chatTree.js");
      const raw = await appendChatMessage(this.prisma, {
        id: input.id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        attachments: input.attachments,
        toolCalls: input.toolCalls,
        toolResults: input.toolResults,
        tokenUsage: input.tokenUsage,
        finishReason: input.finishReason,
        source: input.source,
      });
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
      const uniqueConflict = failureFromPrismaUnique(error, "创建", this.entityName);
      if (uniqueConflict) return uniqueConflict;
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  protected override async afterCreate(entity: MessageEntity, input: CreateMessageInput): Promise<void> {
    // updatedAt / activeLeafId 已由 appendChatMessage 同事务推进；此处只广播。
    await super.afterCreate(entity, input);
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: messageUpsertPayload(entity),
      });
    } catch {
      /* StreamHub 未初始化或会话已清理，忽略 */
    }
  }

  /**
   * 手工编辑 content 时同步 assistant versionMeta（激活版本），
   * 调用方未显式传 toolResults 才介入（switchVersion 自带 toolResults）。
   */
  override async update(input: UpdateMessageInput): Promise<OperationResult<MessageEntity>> {
    let next = input;
    if (typeof input.content === "string" && input.toolResults === undefined) {
      const existing = await this.delegate.findUnique({ where: { id: input.id } });
      if (existing?.role === "assistant") {
        const { syncAssistantActiveContent } = await import("./infra/messageVersions.js");
        next = {
          ...input,
          toolResults: syncAssistantActiveContent(existing, input.content),
        };
      }
    }
    return super.update(next);
  }

  protected override async afterUpdate(entity: MessageEntity, _existing: any, _input: UpdateMessageInput): Promise<void> {
    await super.afterUpdate(entity, _existing, _input);
    try {
      const { getStreamHub } = await import("./infra/sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: messageUpsertPayload(entity),
      });
    } catch {
      /* ignore */
    }
  }

  async setLabel(input: { messageId: string; label: string | null }): Promise<MessageEntity> {
    const { setMessageLabel } = await import("./infra/chatTree.js");
    const updated = await setMessageLabel(this.prisma, input);
    const entity = this.formatEntity(updated);
    await this.afterUpdate(entity, updated, { id: input.messageId } as UpdateMessageInput);
    return entity;
  }

  /** 树语义删除：子节点重挂 + activeLeafId 归位（禁止裸 delegate.delete） */
  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      const { removeChatMessage } = await import("./infra/chatTree.js");
      await removeChatMessage(this.prisma, id);
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
   * 构建 LLM 上下文专用历史（仅活跃路径，排除 branch_summary）：
   * - 有 since（通常 = contextCompactedAt）：取该时刻起的最近 limit 条
   * - 无 since：取活跃路径最近 limit 条
   */
  async listForLlmContext(input: {
    sessionId: string;
    since?: Date | string | null;
    limit?: number;
  }): Promise<MessageEntity[]> {
    const { resolveActivePath, BRANCH_SUMMARY_KIND, healBrokenChatTree } = await import(
      "./infra/chatTree.js"
    );
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const since = input.since ? new Date(input.since) : null;
    await healBrokenChatTree(this.prisma, input.sessionId).catch(() => null);
    const session = await this.prisma.chatSession.findUnique({
      where: { id: input.sessionId },
      select: { activeLeafId: true },
    });
    const all = await this.prisma.chatMessage.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "asc" },
    });
    let path = resolveActivePath(all, session?.activeLeafId).filter(
      (m) => m.kind !== BRANCH_SUMMARY_KIND,
    );
    if (since && !Number.isNaN(since.getTime())) {
      path = path.filter((m) => m.createdAt >= since);
    }
    if (path.length > limit) path = path.slice(-limit);
    return path.map((i: any) => this.formatEntity(i));
  }

  /**
   * Chat 专用 cursor 无限查询（默认活跃路径 + 路径上挂的 branch_summary）。
   * tree:true 调试模式返回全树按 createdAt。
   */
  async listForChat(input: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    tree?: boolean;
  }): Promise<{ items: MessageEntity[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    let ordered: any[];

    if (input.tree) {
      ordered = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
      });
    } else {
      const { resolveActivePathWithSummaries, healBrokenChatTree } = await import(
        "./infra/chatTree.js"
      );
      // 读路径自愈：全树悬空 parent / 幽灵 leaf 先修再取路径
      await healBrokenChatTree(this.prisma, input.sessionId).catch(() => ({
        healed: false,
        activeLeafId: null,
        repairedCount: 0,
      }));
      const session = await this.prisma.chatSession.findUnique({
        where: { id: input.sessionId },
        select: { activeLeafId: true },
      });
      const all = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
      });
      ordered = resolveActivePathWithSummaries(all, session?.activeLeafId);
    }

    let window: any[];
    if (input.cursor) {
      const idx = ordered.findIndex((m) => m.id === input.cursor);
      if (idx <= 0) return { items: [] };
      const start = Math.max(0, idx - limit);
      window = ordered.slice(start, idx);
    } else {
      window = ordered.slice(-limit);
    }

    const formatted = window.map((i: any) => this.formatEntity(i));
    const nextCursor = formatted.length >= limit && ordered[0]?.id !== formatted[0]?.id
      ? formatted[0]?.id
      : formatted.length >= limit
        ? formatted[0]?.id
        : undefined;
    // 已到顶：本页覆盖到 ordered[0]
    const reachedTop = formatted.length > 0 && formatted[0]?.id === ordered[0]?.id;
    return { items: formatted, nextCursor: reachedTop ? undefined : nextCursor };
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
  claimedAt: Date | null;
  createdAt: Date;
}

/**
 * B2：软认领超龄阈值。
 * 长工具/spawn 流式常 >30s；过短会把「已起流未 finalize」项 release 回待发 → 刷新后幽灵排队。
 * 超龄时若已有同 content 的 user ChatMessage，必须 finalize 删行，禁止 release。
 */
export const SESSION_QUEUE_CLAIM_STALE_MS = 15 * 60_000;

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

      // B7：maxOrder + create 同事务串行化；@@unique([sessionId, agentMessageId]) 兜底并发双建
      const raw = await this.prisma.$transaction(async (tx) => {
        const maxOrder = await tx.sessionQueueItem.aggregate({
          where: { sessionId: input.sessionId },
          _max: { order: true },
        });
        const order = (maxOrder._max.order ?? -10) + 10;
        return tx.sessionQueueItem.create({
          data: { ...this.buildCreateData(input), order },
        });
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
      // B7：唯一约束冲突 → 幂等返回已有行（服务端 busy + 前端镜像并发）
      const code = (error as { code?: string })?.code;
      if (code === "P2002" && input.kind === "superior" && input.agentMessageId) {
        const existing = await this.prisma.sessionQueueItem.findFirst({
          where: { sessionId: input.sessionId, agentMessageId: input.agentMessageId },
        });
        if (existing) {
          const entity = this.formatEntity(existing);
          await this.pushQueueUpdate(entity.sessionId, entity.kind);
          return success({
            data: entity,
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }
      }
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

  /** 按 session 列出未认领队列项（按 order 升序）；已软认领项对 UI/drain 不可见 */
  async listBySession(sessionId: string): Promise<SessionQueueItemEntity[]> {
    const rows = await this.prisma.sessionQueueItem.findMany({
      where: { sessionId, claimedAt: null },
      orderBy: { order: "asc" },
    });
    // 已落库为 ChatMessage 的 user 项不再暴露（防 release/竞态后刷新进「待发」）
    const userRows = rows.filter((r) => r.kind === "user" || r.kind === "child_notify");
    if (userRows.length === 0) return rows.map((r) => this.formatEntity(r));
    const delivered = await this.prisma.chatMessage.findMany({
      where: {
        sessionId,
        role: "user",
        content: { in: [...new Set(userRows.map((r) => r.content))] },
      },
      select: { content: true },
    });
    if (delivered.length === 0) return rows.map((r) => this.formatEntity(r));
    const deliveredSet = new Set(delivered.map((d) => d.content));
    const orphanIds = userRows.filter((r) => deliveredSet.has(r.content)).map((r) => r.id);
    if (orphanIds.length > 0) {
      // 异步清幽灵行：不阻塞 list；失败留给 reconciler
      this.prisma.sessionQueueItem
        .deleteMany({ where: { id: { in: orphanIds }, claimedAt: null } })
        .catch(() => {});
    }
    return rows
      .filter((r) => !(r.kind === "user" || r.kind === "child_notify") || !deliveredSet.has(r.content))
      .map((r) => this.formatEntity(r));
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
   * B2 软认领：条件写置 claimedAt（不再删行）。
   * 并发双 consume 落选方 claimed:false；行对 listBySession 不可见，待 ChatMessage 落地后 finalize 删行。
   */
  async consume(id: string): Promise<{ success: boolean; claimed: boolean }> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item) {
      return { success: true, claimed: false };
    }
    if (item.claimedAt) {
      return { success: true, claimed: false };
    }

    const claimed = await this.prisma.sessionQueueItem.updateMany({
      where: { id, claimedAt: null },
      data: { claimedAt: new Date() },
    });
    if (claimed.count > 0) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return { success: true, claimed: claimed.count > 0 };
  }

  /**
   * B2 落地确认：ChatMessage 已写入后删行 + 标记关联 AgentMessage consumed。
   * 幂等——行已删 / 未认领均 success；对外不暴露中间态。
   */
  async finalize(id: string): Promise<{ success: boolean; finalized: boolean }> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item) {
      return { success: true, finalized: false };
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      const del = await tx.sessionQueueItem.deleteMany({ where: { id, claimedAt: { not: null } } });
      if (del.count === 0) return false;
      if (item.kind === "superior" && item.agentMessageId) {
        // W16a-1：delivered → consumed 不动 deliveredAt；pending 直跳 consumed 兜底补齐。
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
    if (finalized) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return { success: true, finalized };
  }

  /**
   * B2 启动/周期恢复：扫 claimedAt 超龄且未 finalize 的项。
   * - 已有同 content 的 user ChatMessage → finalize 删行（流式中途绝不可 release 回待发）
   * - 否则重置 claimedAt=null 供重投（崩溃窗口可恢复）
   */
  async releaseStaleClaims(staleMs = SESSION_QUEUE_CLAIM_STALE_MS): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(0, staleMs));
    const stale = await this.prisma.sessionQueueItem.findMany({
      where: { claimedAt: { not: null, lt: cutoff } },
    });
    if (stale.length === 0) return 0;
    let touched = 0;
    const sessionIds = new Set<string>();
    for (const item of stale) {
      const delivered =
        item.kind === "user" || item.kind === "child_notify"
          ? await this.prisma.chatMessage.findFirst({
              where: { sessionId: item.sessionId, role: "user", content: item.content },
              select: { id: true },
            })
          : null;
      if (delivered) {
        const fin = await this.finalize(item.id);
        if (fin.finalized) {
          touched += 1;
          sessionIds.add(item.sessionId);
        }
        continue;
      }
      const r = await this.prisma.sessionQueueItem.updateMany({
        where: { id: item.id, claimedAt: { not: null, lt: cutoff } },
        data: { claimedAt: null },
      });
      if (r.count > 0) {
        touched += 1;
        sessionIds.add(item.sessionId);
      }
    }
    for (const sessionId of sessionIds) {
      await this.pushQueueUpdate(sessionId, "user");
    }
    return touched;
  }

  /** 单条软认领回滚（busy/409 后重投）；成功则推 session_queue_update */
  async unclaim(id: string): Promise<boolean> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item?.claimedAt) return false;
    const r = await this.prisma.sessionQueueItem.updateMany({
      where: { id, claimedAt: { not: null } },
      data: { claimedAt: null },
    });
    if (r.count > 0) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
      return true;
    }
    return false;
  }

  /**
   * run 收尾：处理本会话未 finalize 的软认领。
   * - 认领后已有同 content 的 user ChatMessage → finalize 删行（防重复投递）
   * - 否则重置 claimedAt，供下一轮 drain（修 busy/409 认领后卡死）
   */
  async reconcileClaimsAfterRun(sessionId: string): Promise<number> {
    const claimed = await this.prisma.sessionQueueItem.findMany({
      where: { sessionId, claimedAt: { not: null } },
      orderBy: { order: "asc" },
    });
    if (claimed.length === 0) return 0;
    let touched = 0;
    for (const item of claimed) {
      const delivered = await this.prisma.chatMessage.findFirst({
        where: {
          sessionId,
          role: "user",
          content: item.content,
          createdAt: { gte: item.claimedAt! },
        },
        select: { id: true },
      });
      if (delivered) {
        const fin = await this.finalize(item.id);
        if (fin.finalized) touched += 1;
      } else {
        const r = await this.prisma.sessionQueueItem.updateMany({
          where: { id: item.id, claimedAt: { not: null } },
          data: { claimedAt: null },
        });
        if (r.count > 0) touched += 1;
      }
    }
    if (touched > 0) {
      await this.pushQueueUpdate(sessionId, "user");
    }
    return touched;
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

  async upload(input: {
    name: string;
    mimeType: string;
    size: number;
    data: string;
    garden?: string;
    postId?: string;
    draftKey?: string;
  }): Promise<OperationResult<any>> {
    const start = Date.now();
    try {
      const { name, mimeType, size, data, garden, postId, draftKey } = input;
      const safeName = path.basename(name);
      const ext = path.extname(safeName);
      const baseName = path.basename(safeName, ext).replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "file";
      const uniqueName = `${baseName}_${Date.now().toString(36)}${ext}`;
      const uploadRoot = path.resolve(this.config.uploadDir);

      // 按 postId（或草稿 draftKey）分目录，与 slug 解耦——改 slug 不断图片链
      const segments: string[] = [];
      if (garden) segments.push(garden);
      if (postId) {
        segments.push(postId);
      } else if (draftKey) {
        segments.push("_draft", draftKey);
      }

      const destDir = segments.length > 0 ? path.resolve(uploadRoot, ...segments) : uploadRoot;
      const relToRoot = path.relative(uploadRoot, destDir);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        throw new Error(`非法上传目录：拒绝写出 uploads 根之外（garden/postId 穿越）`);
      }
      fs.mkdirSync(destDir, { recursive: true });

      const filePath = path.join(destDir, uniqueName);
      const buffer = Buffer.from(data, "base64");
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/uploads/${[...segments, uniqueName].join("/")}`;
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

  protected override async afterCreate(entity: any, input: CreateTaskInput): Promise<void> {
    await super.afterCreate(entity, input);
    if (entity?.type === "cron" && entity.cronExpression) {
      const { tryGetTaskScheduler } = await import("./infra/taskScheduler.js");
      await tryGetTaskScheduler()?.upsertCronJob(entity.id);
    }
  }

  protected override async afterUpdate(entity: any, existing: any, input: UpdateTaskInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    const { tryGetTaskScheduler } = await import("./infra/taskScheduler.js");
    const scheduler = tryGetTaskScheduler();
    if (scheduler) {
      if (entity?.type === "cron" && entity.cronExpression) {
        await scheduler.upsertCronJob(entity.id);
      } else {
        scheduler.removeCronJob(entity.id);
      }
    }
    if (input.status !== undefined && input.status !== existing?.status) {
      const { notifyAllMainSessionsUi } = await import("./infra/uiStateNotify.js");
      await notifyAllMainSessionsUi(this.prisma, {
        type: "task_updated",
        taskId: entity.id,
        status: entity.status,
      });
    }
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    const { tryGetTaskScheduler } = await import("./infra/taskScheduler.js");
    tryGetTaskScheduler()?.removeCronJob(existing.id);
  }

  /** 立即执行任务（db:sync 等）；认领单点 = claimTaskRun，落选如实返回「正在运行」 */
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

    const claimed = await claimTaskRun(this.prisma, id);
    if (!claimed) {
      return failure({
        code: "TASK_ALREADY_RUNNING",
        message: `任务「${task.name}」正在运行，请等待完成后再触发。`,
        details: { id },
        suggestion: "同一任务同时只允许一个执行体；稍后重试或先取消当前运行。",
        retryable: true,
        operation: "run",
        entity: this.entityName,
        durationMs: 0,
      });
    }

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
  protected buildCreateData(input: CreateApprovalInput) {
    // W3：服务端派生 decisionScope（LLM/客户端不可传业务语义；已有则保留）
    const args =
      input.args && typeof input.args === "object" && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {};
    const decisionScope =
      typeof input.decisionScope === "string" && input.decisionScope.trim()
        ? input.decisionScope.trim()
        : deriveDecisionScope(input.toolName, args);
    return { ...input, decisionScope };
  }
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
  protected override async afterCreate(entity: any, input: CreateApprovalInput): Promise<void> {
    await super.afterCreate(entity, input);
    const { notifyAllMainSessionsUi } = await import("./infra/uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "approval_updated",
      approvalId: entity.id,
      status: entity.status,
    });
  }

  protected override async afterUpdate(entity: any, existing: any, input: UpdateApprovalInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    if (input.status === "rejected") {
      notifyApprovalResolved(entity.id, {
        outcome: "rejected",
        approvalId: entity.id,
        toolName: entity.toolName ?? "unknown",
      });
    }
    const { notifyAllMainSessionsUi } = await import("./infra/uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "approval_updated",
      approvalId: entity.id,
      status: entity.status,
    });
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
  // P2-5：Runs 列表 UI 只需 status/agent/session/耗时/token/时间；
  // W3：保留 output（phase/blockedScopes）供 awaiting_human 卡展示被堵 scope；input/toolCalls/error 仍裁剪。
  protected override getListSelect(): any {
    return {
      id: true,
      agentId: true,
      sessionId: true,
      status: true,
      durationMs: true,
      toolCallCount: true,
      tokenUsage: true,
      output: true,
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

/** 知识 Inbox — 截图 / 平台收藏待消化队列（仅 DB，原始件在 data/inbox/） */
export class InboxService extends BaseService<
  CreateInboxItemInput,
  UpdateInboxItemInput,
  ListInboxItemsInput,
  import("@knowpilot/shared").InboxItem
> {
  readonly entityName = "inbox";
  protected get delegate() { return this.prisma.inboxItem; }

  protected formatEntity(raw: any): import("@knowpilot/shared").InboxItem {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = raw.metadata ? JSON.parse(raw.metadata) : {};
    } catch {
      metadata = {};
    }
    return {
      ...raw,
      content: raw.content ?? null,
      tags: raw.tags ? String(raw.tags).split(",").filter(Boolean).map((t: string) => t.trim()) : [],
      metadata,
    };
  }

  /** 列表不拉 content：上千条正文 LIKE + 整段回传是搜索卡顿主因；正文走 getById */
  protected override getListSelect(): any {
    return {
      id: true,
      source: true,
      externalId: true,
      title: true,
      url: true,
      excerpt: true,
      contentPath: true,
      status: true,
      tags: true,
      metadata: true,
      distilledPostId: true,
      sourceAt: true,
      capturedAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  // keyword 优先 FTS（含正文索引）；未命中再 LIKE 短字段，禁止扫 content/metadata
  async list(input: ListInboxItemsInput): Promise<PaginatedResult<import("@knowpilot/shared").InboxItem>> {
    if (input.keyword && !(input as any).ftsIds) {
      try {
        const hits = await searchFtsByEntity(this.prisma, "inbox", input.keyword, 500);
        const ids = hits.map((h) => h.entityId).filter(Boolean);
        if (ids.length > 0) {
          return super.list({ ...input, ftsIds: ids } as any);
        }
      } catch {
        // FTS 不可用，回退短字段 LIKE
      }
    }
    return super.list(input);
  }

  protected buildListWhere(input: ListInboxItemsInput): any {
    const where: any = {};
    if (input.source) where.source = input.source;
    if (input.status) where.status = input.status;
    const and: any[] = [];
    if (input.tag) {
      const t = input.tag.trim();
      // CSV token 精确匹配（fav⊂favorite 时裸 contains 会误伤）
      and.push({
        OR: [
          { tags: t },
          { tags: { startsWith: `${t},` } },
          { tags: { endsWith: `,${t}` } },
          { tags: { contains: `,${t},` } },
        ],
      });
    }
    if (input.collectionId) {
      if (input.collectionId === "unknown") {
        and.push({ source: "zhihu" }, { NOT: { metadata: { contains: '"collectionId"' } } });
      } else {
        where.metadata = { contains: `"collectionId":"${input.collectionId}"` };
      }
    }
    if ((input as any).ftsIds) {
      where.id = { in: (input as any).ftsIds };
    } else if (input.keyword) {
      // 短字段 LIKE 兜底：绝不扫 content/metadata（全表 LIKE 正文会卡数秒）
      where.OR = [
        { title: { contains: input.keyword } },
        { excerpt: { contains: input.keyword } },
        { url: { contains: input.keyword } },
        { tags: { contains: input.keyword } },
      ];
    }
    if (and.length) where.AND = [...(where.AND ?? []), ...and];
    return where;
  }

  protected override getOrderBy(input: ListInboxItemsInput): any {
    const order = input.order || "desc";
    const orderBy = input.orderBy || "capturedAt";
    // sourceAt 为空的条目回退到 capturedAt
    if (orderBy === "sourceAt") {
      return [{ sourceAt: order }, { capturedAt: order }];
    }
    return { [orderBy]: order };
  }

  protected override async afterCreate(
    entity: import("@knowpilot/shared").InboxItem,
    _input: CreateInboxItemInput,
  ): Promise<void> {
    await super.afterCreate(entity, _input);
    try {
      await upsertFtsRow(
        this.prisma,
        "inbox",
        entity.id,
        entity.title,
        `[${entity.source}] ${entity.url ?? ""}\n${entity.tags.join(",")}\n${entity.excerpt ?? ""}\n${entity.content ?? ""}`,
      );
    } catch (err) {
      console.warn("[inbox] FTS afterCreate 失败:", err instanceof Error ? err.message : err);
    }
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    try {
      await deleteFtsRow(this.prisma, "inbox", existing.id);
    } catch (err) {
      console.warn("[inbox] FTS afterDelete 失败:", err instanceof Error ? err.message : err);
    }
  }

  /** 批量删除：单次 deleteMany + 逐条清 FTS（已蒸馏 Post 不动） */
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return { deleted: 0 };
    const existing = await this.prisma.inboxItem.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    const found = existing.map((r) => r.id);
    if (!found.length) return { deleted: 0 };
    await this.prisma.inboxItem.deleteMany({ where: { id: { in: found } } });
    for (const id of found) {
      try {
        await deleteFtsRow(this.prisma, "inbox", id);
      } catch (err) {
        console.warn("[inbox] FTS bulkDelete 失败:", err instanceof Error ? err.message : err);
      }
    }
    return { deleted: found.length };
  }

  /** 分面：来源用 groupBy；收藏夹/标签只扫轻量字段 */
  async facets(input: { status?: string } = {}) {
    const where: { status?: string } = {};
    if (input.status) where.status = input.status;

    const [total, sourceGroups, zhihuRows, xhsRows, bilibiliRows] = await Promise.all([
      this.prisma.inboxItem.count({ where }),
      this.prisma.inboxItem.groupBy({
        by: ["source"],
        where,
        _count: { _all: true },
      }),
      this.prisma.inboxItem.findMany({
        where: { ...where, source: "zhihu" },
        select: { metadata: true },
      }),
      this.prisma.inboxItem.findMany({
        where: { ...where, source: "xhs" },
        select: { tags: true },
      }),
      this.prisma.inboxItem.findMany({
        where: { ...where, source: "bilibili" },
        select: { tags: true, metadata: true },
      }),
    ]);

    const bySource: Record<string, number> = {};
    for (const g of sourceGroups) bySource[g.source] = g._count._all;

    const zhihuMap = new Map<string, { id: string; title: string; count: number }>();
    for (const row of zhihuRows) {
      let meta: Record<string, unknown> = {};
      try {
        meta = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        meta = {};
      }
      const id = meta.collectionId != null ? String(meta.collectionId) : "unknown";
      const title =
        typeof meta.collectionTitle === "string" && meta.collectionTitle
          ? meta.collectionTitle
          : id === "unknown"
            ? "未标注收藏夹"
            : `收藏夹 ${id}`;
      const prev = zhihuMap.get(id) ?? { id, title, count: 0 };
      prev.count += 1;
      if (typeof meta.collectionTitle === "string" && meta.collectionTitle) {
        prev.title = meta.collectionTitle;
      }
      zhihuMap.set(id, prev);
    }

    let xhsLike = 0;
    let xhsFavorite = 0;
    for (const row of xhsRows) {
      const tags = String(row.tags || "").split(",");
      if (tags.includes("like")) xhsLike += 1;
      if (tags.includes("favorite")) xhsFavorite += 1;
    }

    let bilibiliFav = 0;
    let bilibiliToview = 0;
    const bilibiliMap = new Map<string, { id: string; title: string; count: number }>();
    for (const row of bilibiliRows) {
      const tags = String(row.tags || "").split(",");
      if (tags.includes("toview")) bilibiliToview += 1;
      if (tags.includes("favorite")) bilibiliFav += 1;
      let meta: Record<string, unknown> = {};
      try {
        meta = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        meta = {};
      }
      if (meta.collectionId != null) {
        const id = String(meta.collectionId);
        const title =
          typeof meta.collectionTitle === "string" && meta.collectionTitle
            ? meta.collectionTitle
            : `收藏夹 ${id}`;
        const prev = bilibiliMap.get(id) ?? { id, title, count: 0 };
        prev.count += 1;
        if (typeof meta.collectionTitle === "string" && meta.collectionTitle) {
          prev.title = meta.collectionTitle;
        }
        bilibiliMap.set(id, prev);
      }
    }

    return {
      total,
      bySource,
      zhihuCollections: Array.from(zhihuMap.values()).sort((a, b) => b.count - a.count),
      xhs: { like: xhsLike, favorite: xhsFavorite },
      bilibili: { favorite: bilibiliFav, toview: bilibiliToview },
      bilibiliCollections: Array.from(bilibiliMap.values()).sort((a, b) => b.count - a.count),
    };
  }

  protected buildCreateData(input: CreateInboxItemInput): any {
    return {
      source: input.source,
      externalId: input.externalId,
      title: input.title.trim(),
      url: input.url ?? null,
      excerpt: input.excerpt ?? null,
      contentPath: input.contentPath ?? null,
      content: input.content ?? null,
      tags: input.tags?.join(",") || "",
      metadata: JSON.stringify(input.metadata ?? {}),
      status: input.status ?? "fetched",
    };
  }

  protected buildUpdateData(input: UpdateInboxItemInput): any {
    const { id: _id, tags, metadata, ...rest } = input;
    const data: any = { ...rest };
    if (tags !== undefined) data.tags = tags.join(",");
    if (metadata !== undefined) data.metadata = JSON.stringify(metadata);
    return data;
  }

  async captureUrl(input: InboxCaptureUrlInput) {
    const { captureInboxUrl, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    return captureInboxUrl(this.prisma, this.config, input);
  }

  async captureUrls(input: InboxCaptureUrlsInput) {
    const { captureInboxUrls, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    return captureInboxUrls(this.prisma, this.config, input);
  }

  async syncZhihu(
    input: InboxSyncZhihuInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncZhihuCollection, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxSyncZhihuSchema.parse(input ?? {});
    return syncZhihuCollection(this.prisma, this.config, {
      ...parsed,
      onProgress,
      shouldAbort,
    });
  }

  async syncXhs(
    input: InboxSyncXhsInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncXhsLibrary, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxSyncXhsSchema.parse(input ?? {});
    return syncXhsLibrary(this.prisma, this.config, { ...parsed, onProgress, shouldAbort });
  }

  async syncBilibili(
    input: InboxSyncBilibiliInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncBilibiliLibrary, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxSyncBilibiliSchema.parse(input ?? {});
    return syncBilibiliLibrary(this.prisma, this.config, {
      ...parsed,
      onProgress,
      shouldAbort,
    });
  }

  async startPlatformSync(input: InboxPlatformSyncStartInput) {
    const { startInboxPlatformSyncJob } = await import("./infra/inboxPlatformSyncJob.js");
    const { ensureInboxDirs } = await import("./infra/inbox/index.js");
    const { getServiceContainer } = await import("./infra/serviceContainer.js");
    ensureInboxDirs(this.config);
    const parsed = inboxPlatformSyncStartSchema.parse(input ?? {});
    try {
      const services = getServiceContainer(this.prisma, this.eventBus, this.config);
      return startInboxPlatformSyncJob(services, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: message.includes("进行中") ? "CONFLICT" : "BAD_REQUEST",
        message,
      });
    }
  }

  async getPlatformSyncProgress(jobId: string) {
    const { getInboxPlatformSyncJob } = await import("./infra/inboxPlatformSyncJob.js");
    const job = getInboxPlatformSyncJob(jobId);
    if (!job) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `同步任务不存在或已过期: ${jobId}`,
      });
    }
    return job;
  }

  async getActivePlatformSync() {
    const { getActiveInboxPlatformSyncJob } = await import("./infra/inboxPlatformSyncJob.js");
    return getActiveInboxPlatformSyncJob();
  }

  async getLatestPlatformSync() {
    const { getLatestInboxPlatformSyncJob } = await import("./infra/inboxPlatformSyncJob.js");
    return getLatestInboxPlatformSyncJob();
  }

  async cancelPlatformSync(jobId?: string) {
    const { cancelInboxPlatformSyncJob } = await import("./infra/inboxPlatformSyncJob.js");
    try {
      return cancelInboxPlatformSyncJob(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: message.includes("不存在") ? "NOT_FOUND" : "BAD_REQUEST",
        message,
      });
    }
  }

  async scanScreenshots(
    input: InboxScanScreenshotsInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
  ) {
    const { scanScreenshotDrop, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    return scanScreenshotDrop(this.prisma, this.config, { ...input, onProgress });
  }

  async ingestWechatDrop(
    input: InboxIngestWechatDropInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
  ) {
    const { ingestWechatDropFile, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    return ingestWechatDropFile(this.prisma, this.config, { ...input, onProgress });
  }

  async ignoreItems(input: InboxIgnoreInput) {
    const result = await this.prisma.inboxItem.updateMany({
      where: { id: { in: input.ids } },
      data: { status: "ignored" },
    });
    return { success: true, count: result.count };
  }

  /**
   * 分批补正文（防风控）。先列表同步再调用；默认每轮 12 条、条间慢间隔。
   */
  async enrichContent(
    input: InboxEnrichInput,
    onProgress?: import("./infra/inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { enrichInboxMissingContent, ensureInboxDirs } = await import("./infra/inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxEnrichSchema.parse(input ?? {});
    return enrichInboxMissingContent(this.prisma, this.config, {
      ...parsed,
      onProgress,
      shouldAbort,
    });
  }

  async distill(input: InboxDistillInput) {
    const { formatInboxItemBody } = await import("./infra/inbox/index.js");
    const garden = input.garden || this.config.inbox.defaultGarden || "knowledge";
    const items = await this.prisma.inboxItem.findMany({
      where: { id: { in: input.ids } },
    });
    const distilled: Array<{ inboxId: string; postId: string; title: string; path?: string }> = [];
    const errors: string[] = [];

    for (const raw of items) {
      const item = this.formatEntity(raw);
      if (item.status === "ignored") {
        errors.push(`${item.id}: 已忽略，跳过`);
        continue;
      }
      try {
        const body = formatInboxItemBody({
          title: item.title,
          url: item.url,
          source: item.source,
          content: item.content,
          excerpt: item.excerpt,
          contentPath: item.contentPath,
          tags: item.tags,
          metadata: item.metadata,
        });
        const slugBase = item.title
          .toLowerCase()
          .replace(/[^\w\u4e00-\u9fff]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || `inbox-${item.id.slice(-6)}`;
        const slug = `inbox/${slugBase}-${item.id.slice(-6)}`;
        const created = await this.postCreateViaService({
          title: item.title,
          garden,
          slug,
          content: body,
          excerpt: item.excerpt || item.title,
          tags: [...new Set(["inbox", item.source, ...item.tags])],
          published: input.published ?? false,
        });
        await this.prisma.inboxItem.update({
          where: { id: item.id },
          data: { status: "distilled", distilledPostId: created.id },
        });
        distilled.push({
          inboxId: item.id,
          postId: created.id,
          title: created.title,
          path: `content/${garden}/${created.slug}.md`,
        });
      } catch (err) {
        errors.push(`${item.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { distilled, errors, garden };
  }

  /** 同进程内创建 Post（写回 Markdown）；避免经 tRPC 绕圈 */
  private async postCreateViaService(input: {
    title: string;
    garden: string;
    slug: string;
    content: string;
    excerpt: string;
    tags: string[];
    published: boolean;
  }): Promise<{ id: string; title: string; slug: string }> {
    const postService = new PostService(this.prisma, this.eventBus, this.config);
    const result = await postService.create(input as any);
    if (!result.success || !result.data) {
      throw new Error(result.error?.message || "post.create 失败");
    }
    const data = result.data as any;
    return { id: data.id, title: data.title, slug: data.slug };
  }

  async stats() {
    const [fetched, distilled, ignored, total] = await Promise.all([
      this.prisma.inboxItem.count({ where: { status: "fetched" } }),
      this.prisma.inboxItem.count({ where: { status: "distilled" } }),
      this.prisma.inboxItem.count({ where: { status: "ignored" } }),
      this.prisma.inboxItem.count(),
    ]);
    const bySource = await this.prisma.inboxItem.groupBy({
      by: ["source"],
      _count: { _all: true },
    });
    return {
      total,
      fetched,
      distilled,
      ignored,
      bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
      screenshotWatchDir: this.config.inbox.screenshotWatchDir || "data/inbox/screenshots/drop",
      defaultGarden: this.config.inbox.defaultGarden,
    };
  }
}
