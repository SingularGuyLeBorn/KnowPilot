/**
 * post Service（从 services.ts 拆出的叶子）。
 */

import fs from "fs";
import path from "path";
import type {
  CreatePostInput,
  UpdatePostInput,
  ListPostsInput,
  RelatedPostsInput,
  CreatePostFromChatInput,
  OperationResult,
  NextStep,
} from "@knowpilot/shared";
import { DEFAULT_POST_GARDEN, isValidGardenIdFormat, isReservedContentDir } from "@knowpilot/shared";
import { TRPCError } from "@trpc/server";
import matter from "gray-matter";
import {
  FileSyncService,
  ServiceValidationError,
  failureFromPrismaUnique,
  buildPostFtsBody,
  type PaginatedResult,
} from "../../services.js";
import { success, failure, failureFromError } from "../../trpc/result.js";
import { resolveGardenDir } from "../config.js";
import { stripLeadingMarkdownFrontmatter } from "../../scripts/sync/utils.js";
import { upsertFtsRow, deleteFtsRow, searchFts, searchFtsByEntity } from "../ftsIndex.js";
import { assertPathWithinProjectRoot } from "../safePath.js";

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
    // gray-matter/js-yaml 统一序列化：引号/反斜杠/换行由 YAML 库正确转义，杜绝手拼的往返损坏
    const fm: Record<string, unknown> = {
      title: entity.title,
      category: entity.category ?? null,
      published: entity.published,
      excerpt: entity.excerpt ?? null,
    };
    if (entity.tags?.length > 0) fm.tags = entity.tags;
    return matter.stringify(body, fm);
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
      // #11：恢复后重新入 FTS，使文章可被搜索（body 与 create/update 统一含 category/tags）
      await this.syncFts("post", entity.id, entity.title, buildPostFtsBody(entity));
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
