/**
 * Garden 知识库 Service（从 services.ts 拆出的叶子）。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { TRPCError } from "@trpc/server";
import type {
  CreateGardenInput,
  UpdateGardenInput,
  ListGardensInput,
  OperationResult,
} from "@knowpilot/shared";
import {
  SEED_GARDENS,
  isValidGardenIdFormat,
  isReservedContentDir,
} from "@knowpilot/shared";
import {
  BaseService,
  ServiceValidationError,
  type PaginatedResult,
} from "../../services.js";
import { success, failure, failureFromError } from "../../trpc/result.js";
import { resolveGardenDir, resolveGardenMetaPath } from "../config.js";
import { serializeGardenFile } from "../../scripts/sync/sync-gardens.js";

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
