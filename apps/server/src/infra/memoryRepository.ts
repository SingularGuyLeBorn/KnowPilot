/**
 * MemoryRepository — 长期记忆仓储抽象（W5）
 *
 * 背景：此前 prompt 拼接（promptBuilder.buildMemoryContext）、agentEvolution、
 * nativeTools 等 4+ 处直查 Prisma，无 scope 隔离、无淘汰策略、去重靠 slice(0,40)。
 * 本模块是唯一记忆读写入口（MemoryService 的 CRUD/文件双写保留给管理页与 tRPC）：
 *
 * 不变量：
 * 1. 写时隔离：scope ∈ { global, agent:{id}, workspace:{id} }，读方必须显式声明 scopes，
 *    其他 Agent 的 experience 天然不可见（替代读时手工过滤）。
 * 2. 去重：contentHash = sha256(content.trim())，同 scope 同 hash 幂等刷新而非重复插入。
 * 3. 排序：读时按 strength × recencyScore 打分（recencyScore = 1/(1+ageDays)）。
 * 4. 淘汰：decayMemories 每日 strength *= 0.95^days（raw SQL 不改 updatedAt，保证按日复利），
 *    低于 MEMORY_ARCHIVE_THRESHOLD 归档删除（走 MemoryService.delete 同步清理文件与 FTS）。
 * 5. 写路径统一走 MemoryService.create/update：保证文件回写 content/memories/ 与 FTS 增量同步。
 *
 * 本模块是叶子模块：运行时仅依赖 ftsIndex / shared 常量 / node:crypto，
 * ServiceContainer / MemoryService 均为 type-only 导入，不引入 ReAct 环内模块。
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { MemoryService } from "../services.js";
import { searchFts } from "./ftsIndex.js";
import {
  MEMORY_ARCHIVE_THRESHOLD,
  MEMORY_DECAY_FACTOR_PER_DAY,
  MEMORY_INITIAL_STRENGTH,
  MEMORY_SCOPE_GLOBAL,
  MEMORY_SCOPE_PREFIX,
  memoryAgentScope,
  memoryWorkspaceScope,
} from "@knowpilot/shared";

export interface MemoryItem {
  id: string;
  content: string;
  type: string;
  strength: number;
  keywords: string[];
  scope: string;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryReadQuery {
  keyword?: string;
  types?: string[];
  /** 必填：读方必须显式声明可见 scope（写时隔离的配套约束） */
  scopes: string[];
  limit?: number;
}

export interface MemoryWriteInput {
  content: string;
  type: string;
  scope: string;
  strength?: number;
  keywords?: string[];
  sourceSlug?: string;
}

export interface MemoryForgetCriteria {
  scope?: string;
  beforeStrength?: number;
  before?: Date;
}

export interface MemoryRepository {
  read(query: MemoryReadQuery): Promise<MemoryItem[]>;
  write(input: MemoryWriteInput): Promise<MemoryItem>;
  forget(criteria: MemoryForgetCriteria): Promise<number>;
}

/** 内容全量 hash（替代 slice(0,40) 前缀去重） */
export function hashMemoryContent(content: string): string {
  return createHash("sha256").update(content.trim(), "utf-8").digest("hex");
}

/** scope=agent:{id} 时提取冗余 agentId 列 */
function agentIdFromScope(scope: string): string | null {
  return scope.startsWith(MEMORY_SCOPE_PREFIX.AGENT)
    ? scope.slice(MEMORY_SCOPE_PREFIX.AGENT.length) || null
    : null;
}

function recencyScore(updatedAt: Date, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - updatedAt.getTime()) / 86_400_000);
  return 1 / (1 + ageDays);
}

function toItem(raw: {
  id: string;
  content: string;
  type: string;
  strength: number;
  /** Prisma 原始行是逗号分隔字符串；MemoryService.formatEntity 后是数组，本函数两种入参形态都接受 */
  keywords: string | string[];
  scope: string;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryItem {
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords
    : raw.keywords
      ? raw.keywords.split(",").filter(Boolean).map((k) => k.trim())
      : [];
  return {
    id: raw.id,
    content: raw.content,
    type: raw.type,
    strength: raw.strength,
    keywords,
    scope: raw.scope,
    agentId: raw.agentId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(
    private readonly prisma: PrismaClient,
    /** 写/删统一走 MemoryService，保证文件回写 + FTS 增量同步；缺省时退化为裸 Prisma（仅测试用） */
    private readonly memoryService?: MemoryService,
  ) {}

  async read(query: MemoryReadQuery): Promise<MemoryItem[]> {
    const limit = Math.max(1, Math.min(100, query.limit ?? 8));
    const scopes = query.scopes.length > 0 ? query.scopes : [MEMORY_SCOPE_GLOBAL];
    const typeFilter = query.types && query.types.length > 0 ? { type: { in: query.types } } : {};

    let rows: any[] = [];
    // 路径 1：FTS 召回（原 promptBuilder 两条路径收进仓储）
    if (query.keyword) {
      try {
        const hits = await searchFts(this.prisma, query.keyword, Math.max(limit * 4, 20));
        const ids = hits.filter((h) => h.entity === "memory").map((h) => h.entityId);
        if (ids.length > 0) {
          rows = await this.prisma.memory.findMany({
            where: { id: { in: ids }, scope: { in: scopes }, ...typeFilter },
          });
        }
      } catch {
        // FTS 未就绪等，回退 LIKE
      }
    }
    // 路径 2：LIKE 回退；排序在内存做（strength × recency），取宽一点再裁剪
    if (rows.length === 0) {
      rows = await this.prisma.memory.findMany({
        where: {
          scope: { in: scopes },
          ...typeFilter,
          ...(query.keyword
            ? { OR: [{ content: { contains: query.keyword } }, { keywords: { contains: query.keyword } }] }
            : {}),
        },
        take: 200,
      });
    }

    const nowMs = Date.now();
    return rows
      .map((r) => ({ item: toItem(r), score: r.strength * recencyScore(r.updatedAt, nowMs) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.item);
  }

  async write(input: MemoryWriteInput): Promise<MemoryItem> {
    const scope = input.scope || MEMORY_SCOPE_GLOBAL;
    const contentHash = hashMemoryContent(input.content);
    const agentId = agentIdFromScope(scope);

    // 去重：同 scope 同 contentHash → 幂等刷新强度（取高者），不重复插入
    const existing = await this.prisma.memory.findFirst({ where: { scope, contentHash } });
    if (existing) {
      const strength = Math.max(existing.strength, input.strength ?? existing.strength);
      if (this.memoryService) {
        const updated = await this.memoryService.update({ id: existing.id, strength } as any);
        if (updated.success && updated.data) return toItem(updated.data as any);
      }
      const raw = await this.prisma.memory.update({ where: { id: existing.id }, data: { strength } });
      return toItem(raw);
    }

    const createInput = {
      content: input.content,
      type: input.type,
      strength: input.strength ?? MEMORY_INITIAL_STRENGTH,
      keywords: input.keywords ?? [],
      // 以下字段不在 tRPC createMemorySchema 内，由 MemoryService.buildCreateData 透传
      scope,
      agentId,
      contentHash,
      sourceSlug: input.sourceSlug,
    };
    if (this.memoryService) {
      const created = await this.memoryService.create(createInput as any);
      if (!created.success || !created.data) {
        throw new Error(created.error?.message ?? "Memory 创建失败");
      }
      return toItem(created.data as any);
    }
    const raw = await this.prisma.memory.create({
      data: {
        content: createInput.content,
        type: createInput.type,
        strength: createInput.strength,
        keywords: createInput.keywords.join(","),
        scope,
        agentId,
        contentHash,
        sourceSlug: input.sourceSlug ?? undefined,
      },
    });
    return toItem(raw);
  }

  async forget(criteria: MemoryForgetCriteria): Promise<number> {
    const where: any = {};
    if (criteria.scope) where.scope = criteria.scope;
    if (criteria.beforeStrength !== undefined) where.strength = { lt: criteria.beforeStrength };
    if (criteria.before) where.updatedAt = { lt: criteria.before };
    if (Object.keys(where).length === 0) return 0;

    // 逐条走 MemoryService.delete：同步清理 content/ 文件与 FTS 行，避免孤儿文件被 db:sync 复活
    const rows = await this.prisma.memory.findMany({ where, select: { id: true } });
    let deleted = 0;
    for (const row of rows) {
      if (this.memoryService) {
        const r = await this.memoryService.delete(row.id);
        if (r.success) deleted++;
      } else {
        await this.prisma.memory.delete({ where: { id: row.id } });
        deleted++;
      }
    }
    return deleted;
  }
}

export function createMemoryRepository(services: ServiceContainer): MemoryRepository {
  return new PrismaMemoryRepository(services.prisma, services.memory);
}

/* ─── 三层 scope 写路径守卫（W5-followup） ─── */

/** 记忆写入方的身份（来自调用 Agent 快照；无 Agent 时表示用户级聊天） */
export interface MemoryScopeActor {
  agentId?: string | null;
  workspaceId?: string | null;
  tier?: string | null;
}

/**
 * 解析并校验记忆写入 scope（三层隔离的写路径守卫，native memory_create 与测试共用）。
 *
 * 规则（越权直接抛错，不写库）：
 * - 未指定 scope：有调用 Agent → agent 层；无 Agent（用户级聊天）→ 保持原 global 行为。
 * - agent / agent:{id}：只能写自己的 agent scope，禁止伪造其他 Agent。
 * - workspace / workspace:{id}：只能写自己所在 Workspace 的 scope，禁止伪造其他 Workspace。
 * - global：仅 super tier 可写（无 Agent 的用户级聊天不受 tier 约束）。
 */
export function resolveMemoryWriteScope(requested: string | undefined | null, actor: MemoryScopeActor): string {
  const req = (requested ?? "").trim();
  if (!req) {
    return actor.agentId ? memoryAgentScope(actor.agentId) : MEMORY_SCOPE_GLOBAL;
  }
  if (req === MEMORY_SCOPE_GLOBAL) {
    if (!actor.agentId || actor.tier === "super") return MEMORY_SCOPE_GLOBAL;
    throw new Error("仅超级 Agent 可写 global 层记忆；请改用 agent 或 workspace 层");
  }
  if (req === "agent" || req.startsWith(MEMORY_SCOPE_PREFIX.AGENT)) {
    if (!actor.agentId) throw new Error("当前没有调用 Agent，无法写入 agent 层记忆");
    const aid = req === "agent" ? actor.agentId : req.slice(MEMORY_SCOPE_PREFIX.AGENT.length);
    if (aid !== actor.agentId) {
      throw new Error(`越权：只能写入自己的 agent 层记忆，不能伪造 agent:${aid}`);
    }
    return memoryAgentScope(aid);
  }
  if (req === "workspace" || req.startsWith(MEMORY_SCOPE_PREFIX.WORKSPACE)) {
    const wid = req === "workspace" ? actor.workspaceId : req.slice(MEMORY_SCOPE_PREFIX.WORKSPACE.length);
    if (!wid) throw new Error("当前 Agent 不属于任何 Workspace，无法写入 workspace 层记忆");
    if (actor.agentId && wid !== actor.workspaceId) {
      throw new Error(`越权：只能写入自己所在 Workspace 的记忆，不能伪造 workspace:${wid}`);
    }
    return memoryWorkspaceScope(wid);
  }
  throw new Error(`无效的 memory scope：${req}。允许：agent / workspace / global`);
}

/**
 * 长期记忆衰减（每日 cron，挂 HeartbeatEngine 维护任务）：
 * 1. strength *= 0.95^floor(ageDays) —— raw SQL 只改 strength 不动 updatedAt，
 *    保证「距最后活跃 N 天」的基准稳定，实现按日复利衰减；
 * 2. 低于阈值归档删除（forget 走 MemoryService，清理文件 + FTS）。
 */
export async function decayMemories(
  repo: MemoryRepository,
  prisma: PrismaClient,
  opts?: { now?: Date },
): Promise<{ decayed: number; archived: number }> {
  const now = opts?.now ?? new Date();
  const rows = await prisma.memory.findMany({ select: { id: true, strength: true, updatedAt: true } });
  let decayed = 0;
  for (const m of rows) {
    const days = Math.floor((now.getTime() - m.updatedAt.getTime()) / 86_400_000);
    if (days < 1) continue;
    const next = m.strength * Math.pow(MEMORY_DECAY_FACTOR_PER_DAY, days);
    // 注意：raw SQL 更新避免触发 @updatedAt，否则衰减基准会每天被重置，复利失效
    await prisma.$executeRawUnsafe(`UPDATE "Memory" SET "strength" = ? WHERE "id" = ?`, next, m.id);
    decayed++;
  }
  const archived = await repo.forget({ beforeStrength: MEMORY_ARCHIVE_THRESHOLD });
  return { decayed, archived };
}
