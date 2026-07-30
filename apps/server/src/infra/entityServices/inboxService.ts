/**
 * Inbox 知识收集队列 Service（从 services.ts 拆出的叶子）。
 */

import { TRPCError } from "@trpc/server";
import {
  type CreateInboxItemInput,
  type UpdateInboxItemInput,
  type ListInboxItemsInput,
  type InboxCaptureUrlInput,
  type InboxCaptureUrlsInput,
  type InboxSyncZhihuInput,
  type InboxSyncXhsInput,
  type InboxSyncBilibiliInput,
  type InboxPlatformSyncStartInput,
  type InboxScanScreenshotsInput,
  type InboxIngestWechatDropInput,
  type InboxDistillInput,
  type InboxIgnoreInput,
  type InboxEnrichInput,
  inboxSyncZhihuSchema,
  inboxSyncXhsSchema,
  inboxSyncBilibiliSchema,
  inboxPlatformSyncStartSchema,
  inboxEnrichSchema,
} from "@knowpilot/shared";
import {
  BaseService,
  type PaginatedResult,
} from "../../services.js";
import { PostService } from "./postService.js";
import { upsertFtsRow, deleteFtsRow, searchFtsByEntity } from "../ftsIndex.js";

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
    const { captureInboxUrl, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    return captureInboxUrl(this.prisma, this.config, input);
  }

  async captureUrls(input: InboxCaptureUrlsInput) {
    const { captureInboxUrls, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    return captureInboxUrls(this.prisma, this.config, input);
  }

  async syncZhihu(
    input: InboxSyncZhihuInput,
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncZhihuCollection, ensureInboxDirs } = await import("../inbox/index.js");
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
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncXhsLibrary, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxSyncXhsSchema.parse(input ?? {});
    return syncXhsLibrary(this.prisma, this.config, { ...parsed, onProgress, shouldAbort });
  }

  async syncBilibili(
    input: InboxSyncBilibiliInput,
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { syncBilibiliLibrary, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxSyncBilibiliSchema.parse(input ?? {});
    return syncBilibiliLibrary(this.prisma, this.config, {
      ...parsed,
      onProgress,
      shouldAbort,
    });
  }

  async startPlatformSync(input: InboxPlatformSyncStartInput) {
    const { startInboxPlatformSyncJob } = await import("../inboxPlatformSyncJob.js");
    const { ensureInboxDirs } = await import("../inbox/index.js");
    const { getServiceContainer } = await import("../serviceContainer.js");
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
    const { getInboxPlatformSyncJob } = await import("../inboxPlatformSyncJob.js");
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
    const { getActiveInboxPlatformSyncJob } = await import("../inboxPlatformSyncJob.js");
    return getActiveInboxPlatformSyncJob();
  }

  async getLatestPlatformSync() {
    const { getLatestInboxPlatformSyncJob } = await import("../inboxPlatformSyncJob.js");
    return getLatestInboxPlatformSyncJob();
  }

  async cancelPlatformSync(jobId?: string) {
    const { cancelInboxPlatformSyncJob } = await import("../inboxPlatformSyncJob.js");
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
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
  ) {
    const { scanScreenshotDrop, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    return scanScreenshotDrop(this.prisma, this.config, { ...input, onProgress });
  }

  async ingestWechatDrop(
    input: InboxIngestWechatDropInput,
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
  ) {
    const { ingestWechatDropFile, ensureInboxDirs } = await import("../inbox/index.js");
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
    onProgress?: import("../inbox/index.js").InboxSyncProgressFn,
    shouldAbort?: () => boolean,
  ) {
    const { enrichInboxMissingContent, ensureInboxDirs } = await import("../inbox/index.js");
    ensureInboxDirs(this.config);
    const parsed = inboxEnrichSchema.parse(input ?? {});
    return enrichInboxMissingContent(this.prisma, this.config, {
      ...parsed,
      onProgress,
      shouldAbort,
    });
  }

  async distill(input: InboxDistillInput) {
    const { formatInboxItemBody } = await import("../inbox/index.js");
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
