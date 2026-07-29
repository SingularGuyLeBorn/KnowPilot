/**
 * 会话树（W1）：parentId / activeLeafId / 活跃路径 / 分支切换 / branch_summary
 *
 * 叶子模块：仅依赖 Prisma + autoCompact 摘要管道（chatCompletion 风格），无环。
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { AppConfig } from "./config.js";
import { resilientChatCompletion } from "./resilientLlmClient.js";
import { resolveCompactSummaryModel } from "./autoCompact.js";

export const BRANCH_SUMMARY_KIND = "branch_summary";
export const BRANCH_SUMMARY_MARKER = "[kp-branch-summary]";

export type ChatTreeMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  parentId?: string | null;
  label?: string | null;
  kind?: string | null;
  attachments?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
  tokenUsage?: unknown;
  finishReason?: string | null;
  source?: string;
  createdAt: Date;
};

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

function isPrismaClient(db: Db): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === "function";
}

export type AppendChatMessageData = {
  id?: string;
  sessionId: string;
  role: string;
  content: string;
  parentId?: string | null;
  label?: string | null;
  kind?: string | null;
  attachments?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
  tokenUsage?: unknown;
  finishReason?: string | null;
  source?: string;
};

async function messageExistsInSession(
  tx: Tx,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const row = await tx.chatMessage.findFirst({
    where: { id: messageId, sessionId },
    select: { id: true },
  });
  return !!row;
}

async function walkSessionPath(
  tx: Tx,
  sessionId: string,
  startId: string,
): Promise<{ path: Array<{ id: string; parentId: string | null }>; broken: boolean }> {
  const all = await tx.chatMessage.findMany({
    where: { sessionId },
    select: { id: true, parentId: true },
  });
  const byId = new Map(all.map((m) => [m.id, m]));
  return walkActivePath(byId, startId);
}

/** 本会话内、能走到 null 根的合法 parent；否则回退到最新完整链叶 */
async function resolveValidParentId(
  tx: Tx,
  sessionId: string,
  candidateId: string | null,
): Promise<string | null> {
  const all = await tx.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, parentId: true, createdAt: true },
  });
  if (all.length === 0) return null;
  const byId = new Map(all.map((m) => [m.id, m]));

  const isCompleteLeaf = (id: string): boolean => {
    const { path, broken } = walkActivePath(byId, id);
    return !broken && path.length > 0 && path[0]!.parentId == null;
  };

  if (candidateId && byId.has(candidateId) && isCompleteLeaf(candidateId)) {
    return candidateId;
  }

  for (let i = all.length - 1; i >= 0; i--) {
    const id = all[i]!.id;
    if (isCompleteLeaf(id)) return id;
  }
  return all[all.length - 1]!.id;
}

/**
 * 同事务：create 消息（parentId 默认 = 当前 activeLeafId）+ 推进 activeLeafId。
 * branch_summary 等旁路消息传 advanceLeaf=false，且必须显式 parentId。
 */
export async function appendChatMessage(
  db: Db,
  data: AppendChatMessageData,
  options?: { advanceLeaf?: boolean },
): Promise<ChatTreeMessage> {
  const advanceLeaf = options?.advanceLeaf !== false;
  const exec = async (tx: Tx): Promise<ChatTreeMessage> => {
    const session = await tx.chatSession.findUnique({
      where: { id: data.sessionId },
      select: { id: true, activeLeafId: true },
    });
    if (!session) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `会话不存在：appendChatMessage sessionId=${data.sessionId}`,
      });
    }

    // parent 必须：本会话内 + 能走到 parentId=null 的根。否则挂到最新完整链叶（禁止幽灵/断链尖端）
    const candidateParent =
      data.parentId !== undefined ? data.parentId : (session.activeLeafId ?? null);
    const parentId = await resolveValidParentId(tx, data.sessionId, candidateParent);
    if (session.activeLeafId && session.activeLeafId !== parentId) {
      const leafOk = parentId != null && (await messageExistsInSession(tx, data.sessionId, session.activeLeafId));
      const { broken } = leafOk
        ? await walkSessionPath(tx, data.sessionId, session.activeLeafId)
        : { broken: true };
      if (!leafOk || broken) {
        await tx.chatSession.update({
          where: { id: data.sessionId },
          data: { activeLeafId: parentId },
        });
      }
    }

    const created = await tx.chatMessage.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        sessionId: data.sessionId,
        role: data.role,
        content: data.content,
        parentId,
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.attachments !== undefined ? { attachments: data.attachments as Prisma.InputJsonValue } : {}),
        ...(data.toolCalls !== undefined ? { toolCalls: data.toolCalls as Prisma.InputJsonValue } : {}),
        ...(data.toolResults !== undefined ? { toolResults: data.toolResults as Prisma.InputJsonValue } : {}),
        ...(data.tokenUsage !== undefined ? { tokenUsage: data.tokenUsage as Prisma.InputJsonValue } : {}),
        ...(data.finishReason !== undefined ? { finishReason: data.finishReason } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
      },
    });

    if (advanceLeaf) {
      await tx.chatSession.update({
        where: { id: data.sessionId },
        data: { activeLeafId: created.id, updatedAt: new Date() },
      });
    } else {
      await tx.chatSession.update({
        where: { id: data.sessionId },
        data: { updatedAt: new Date() },
      });
    }

    return created as ChatTreeMessage;
  };

  if (isPrismaClient(db)) {
    // 默认 maxWait=2s/timeout=5s，SQLite 高并发写锁排队时事务会被提前关闭（P2034 Transaction already closed）。
    // 配合 db.ts 的 busy_timeout=15s，事务超时放宽到 maxWait=10s/timeout=30s，让等锁方排队完成而非失败。
    return db.$transaction(exec, { maxWait: 10_000, timeout: 30_000 });
  }
  return exec(db);
}

function messageTime(m: { createdAt?: Date | string }): number {
  return m.createdAt ? new Date(m.createdAt).getTime() : 0;
}

/** 从 startId 回溯；若遇悬空 parentId 则 broken=true（路径仅为断点以下片段） */
function walkActivePath<T extends { id: string; parentId?: string | null }>(
  byId: Map<string, T>,
  startId: string,
): { path: T[]; broken: boolean } {
  const path: T[] = [];
  const seen = new Set<string>();
  let cur: string | null = startId;
  let broken = false;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const msg: T = byId.get(cur)!;
    path.push(msg);
    const parentId = msg.parentId ?? null;
    if (parentId && !byId.has(parentId)) {
      broken = true;
      break;
    }
    cur = parentId;
  }
  path.reverse();
  return { path, broken };
}

/**
 * 从 activeLeafId 沿 parentId 回溯到根，再反转 = 活跃路径（根→叶）。
 * 叶存在但祖先悬空时：回退到「能走到 parentId=null 的最新完整链」，并把孤叶挂到链尾，
 * 避免 stop/删尾后刷新只剩「(已中断)」一条。
 */
export function resolveActivePath<T extends { id: string; parentId?: string | null; createdAt?: Date | string }>(
  allMessages: T[],
  activeLeafId: string | null | undefined,
): T[] {
  if (allMessages.length === 0) return [];
  const byId = new Map(allMessages.map((m) => [m.id, m]));

  const sorted = [...allMessages].sort((a, b) => messageTime(a) - messageTime(b));
  let leafId = activeLeafId && byId.has(activeLeafId) ? activeLeafId : null;
  if (!leafId) {
    leafId = sorted[sorted.length - 1]?.id ?? null;
  }
  if (!leafId) return [];

  const primary = walkActivePath(byId, leafId);
  if (
    !primary.broken &&
    primary.path.length > 0 &&
    primary.path[0]!.parentId == null
  ) {
    return primary.path;
  }

  // 断链：找最新一条能走到 null 根的完整链，并把当前孤叶挂到链尾
  let best: T[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i]!.id;
    const { path, broken } = walkActivePath(byId, id);
    if (!broken && path.length > 0 && path[0]!.parentId == null) {
      best = path;
      break;
    }
  }
  if (best.length === 0) {
    // 全库都断：退回按时间序（总比只显示孤叶强）
    return sorted;
  }

  const leaf = byId.get(leafId)!;
  if (!best.some((m) => m.id === leaf.id)) {
    return [...best, leaf];
  }
  return best;
}

/**
 * 会话树自愈（幂等）：扫描**全部**悬空 parentId 并重挂，幽灵 activeLeafId 归位。
 * 不变量：任意可读路径经此函数后，活跃叶能走到 parentId=null。
 */
export async function healBrokenChatTree(
  db: PrismaClient,
  sessionId: string,
): Promise<{ healed: boolean; activeLeafId: string | null; repairedCount: number }> {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    select: { activeLeafId: true },
  });
  if (!session) return { healed: false, activeLeafId: null, repairedCount: 0 };

  const all = await db.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, parentId: true, createdAt: true },
  });
  if (all.length === 0) {
    return { healed: false, activeLeafId: session.activeLeafId, repairedCount: 0 };
  }

  const byId = new Map(all.map((m) => [m.id, { ...m }]));
  const findCompleteLeaf = (excludeId?: string | null): string | null => {
    for (let i = all.length - 1; i >= 0; i--) {
      const id = all[i]!.id;
      if (excludeId && id === excludeId) continue;
      const { path, broken } = walkActivePath(byId, id);
      if (!broken && path.length > 0 && path[0]!.parentId == null) {
        return path[path.length - 1]!.id;
      }
    }
    return null;
  };

  let repairedCount = 0;
  for (const m of all) {
    const row = byId.get(m.id)!;
    if (row.parentId && !byId.has(row.parentId)) {
      const attachTo = findCompleteLeaf(m.id);
      await db.chatMessage.update({
        where: { id: m.id },
        data: { parentId: attachTo },
      });
      row.parentId = attachTo;
      repairedCount += 1;
    }
  }

  let activeLeafId = session.activeLeafId;
  if (activeLeafId && byId.has(activeLeafId)) {
    const { broken } = walkActivePath(byId, activeLeafId);
    if (broken) {
      const attachTo = findCompleteLeaf(activeLeafId);
      await db.chatMessage.update({
        where: { id: activeLeafId },
        data: { parentId: attachTo },
      });
      byId.get(activeLeafId)!.parentId = attachTo;
      repairedCount += 1;
    }
  } else {
    activeLeafId = findCompleteLeaf() ?? all[all.length - 1]!.id;
    if (session.activeLeafId !== activeLeafId) {
      await db.chatSession.update({
        where: { id: sessionId },
        data: { activeLeafId },
      });
      repairedCount += 1;
    }
  }

  return {
    healed: repairedCount > 0,
    activeLeafId: activeLeafId ?? session.activeLeafId,
    repairedCount,
  };
}

/**
 * 树语义删尾：删除 keepMessageId 的全部后代，同事务 activeLeafId=keep。
 * 重试/编辑/重新生成唯一入口（禁止扁平分页 deleteMany）。
 */
export async function truncateAfter(
  db: PrismaClient,
  sessionId: string,
  keepMessageId: string,
): Promise<{ deletedIds: string[] }> {
  const keep = await db.chatMessage.findFirst({
    where: { id: keepMessageId, sessionId },
    select: { id: true },
  });
  if (!keep) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `truncateAfter：消息不存在或不属于会话 keep=${keepMessageId} session=${sessionId}`,
    });
  }

  const all = await db.chatMessage.findMany({
    where: { sessionId },
    select: { id: true, parentId: true },
  });
  const children = new Map<string, string[]>();
  for (const m of all) {
    if (!m.parentId) continue;
    const list = children.get(m.parentId) ?? [];
    list.push(m.id);
    children.set(m.parentId, list);
  }

  const deletedIds: string[] = [];
  const queue = [...(children.get(keepMessageId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    deletedIds.push(id);
    for (const c of children.get(id) ?? []) queue.push(c);
  }

  await db.$transaction(
    async (tx) => {
      if (deletedIds.length > 0) {
        await tx.chatMessage.deleteMany({ where: { id: { in: deletedIds } } });
      }
      // 强制归位：不依赖「leaf 是否在删除集」猜测
      await tx.chatSession.update({
        where: { id: sessionId },
        data: { activeLeafId: keepMessageId, updatedAt: new Date() },
      });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  return { deletedIds };
}

/**
 * 树语义单删：子节点重挂到被删节点的 parent，activeLeafId 若指向被删则归位。
 */
export async function removeChatMessage(
  db: PrismaClient,
  messageId: string,
): Promise<{ sessionId: string; deletedId: string; reparented: number }> {
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, sessionId: true, parentId: true },
  });
  if (!msg) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `removeChatMessage：消息不存在 id=${messageId}`,
    });
  }

  let reparented = 0;
  await db.$transaction(
    async (tx) => {
      const children = await tx.chatMessage.findMany({
        where: { sessionId: msg.sessionId, parentId: messageId },
        select: { id: true },
      });
      if (children.length > 0) {
        const r = await tx.chatMessage.updateMany({
          where: { sessionId: msg.sessionId, parentId: messageId },
          data: { parentId: msg.parentId },
        });
        reparented = r.count;
      }
      await tx.chatMessage.delete({ where: { id: messageId } });

      const session = await tx.chatSession.findUnique({
        where: { id: msg.sessionId },
        select: { activeLeafId: true },
      });
      if (session?.activeLeafId === messageId) {
        const next =
          msg.parentId ??
          (
            await tx.chatMessage.findFirst({
              where: { sessionId: msg.sessionId },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          )?.id ??
          null;
        await tx.chatSession.update({
          where: { id: msg.sessionId },
          data: { activeLeafId: next, updatedAt: new Date() },
        });
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  return { sessionId: msg.sessionId, deletedId: messageId, reparented };
}

/** 活跃路径 + 挂在路径节点上的 branch_summary（展示用，不进 LLM） */
export function resolveActivePathWithSummaries<
  T extends { id: string; parentId?: string | null; kind?: string | null; createdAt?: Date | string },
>(allMessages: T[], activeLeafId: string | null | undefined): T[] {
  const path = resolveActivePath(
    allMessages.filter((m) => m.kind !== BRANCH_SUMMARY_KIND),
    activeLeafId,
  );
  const pathIds = new Set(path.map((m) => m.id));
  const summaries = allMessages
    .filter(
      (m) =>
        m.kind === BRANCH_SUMMARY_KIND &&
        m.parentId != null &&
        pathIds.has(m.parentId),
    )
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

  if (summaries.length === 0) return path;

  const out: T[] = [];
  for (const m of path) {
    out.push(m);
    for (const s of summaries) {
      if (s.parentId === m.id) out.push(s);
    }
  }
  return out;
}

export function pathIdsFromRoot(
  allMessages: Array<{ id: string; parentId?: string | null }>,
  leafId: string | null | undefined,
): string[] {
  return resolveActivePath(allMessages, leafId).map((m) => m.id);
}

/** 最低公共祖先 id；无公共则 null */
export function findLcaId(
  allMessages: Array<{ id: string; parentId?: string | null }>,
  leafA: string | null | undefined,
  leafB: string | null | undefined,
): string | null {
  if (!leafA || !leafB) return null;
  const setA = new Set(pathIdsFromRoot(allMessages, leafA));
  const pathB = pathIdsFromRoot(allMessages, leafB);
  let lca: string | null = null;
  for (const id of pathB) {
    if (setA.has(id)) lca = id;
  }
  return lca;
}

/** 存量线性消息回填为单链树（migrate-chat-tree 脚本与测试共用） */
export async function backfillChatTree(prisma: PrismaClient): Promise<{
  sessions: number;
  messages: number;
}> {
  const sessions = await prisma.chatSession.findMany({ select: { id: true } });
  let messages = 0;
  for (const s of sessions) {
    const msgs = await prisma.chatMessage.findMany({
      where: { sessionId: s.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, parentId: true },
    });
    let prev: string | null = null;
    for (const m of msgs) {
      if (m.parentId !== prev) {
        await prisma.chatMessage.update({
          where: { id: m.id },
          data: { parentId: prev },
        });
      }
      prev = m.id;
      messages++;
    }
    await prisma.chatSession.update({
      where: { id: s.id },
      data: { activeLeafId: prev },
    });
  }
  return { sessions: sessions.length, messages };
}

export type SessionTreeNode = {
  id: string;
  parentId: string | null;
  role: string;
  label: string | null;
  kind: string | null;
  contentPreview: string;
  createdAt: string;
};

export type SessionTreeResult = {
  sessionId: string;
  activeLeafId: string | null;
  nodes: SessionTreeNode[];
  /** parentId → children ids；根用 "" */
  children: Record<string, string[]>;
};

export async function getSessionTree(
  prisma: PrismaClient,
  sessionId: string,
): Promise<SessionTreeResult> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, activeLeafId: true },
  });
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: `会话不存在：${sessionId}` });
  }
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      role: true,
      label: true,
      kind: true,
      content: true,
      createdAt: true,
    },
  });
  const children: Record<string, string[]> = {};
  const nodes: SessionTreeNode[] = msgs.map((m) => {
    const key = m.parentId ?? "";
    if (!children[key]) children[key] = [];
    children[key]!.push(m.id);
    return {
      id: m.id,
      parentId: m.parentId ?? null,
      role: m.role,
      label: m.label ?? null,
      kind: m.kind ?? null,
      contentPreview: m.content.slice(0, 120),
      createdAt: m.createdAt.toISOString(),
    };
  });
  return {
    sessionId,
    activeLeafId: session.activeLeafId ?? null,
    nodes,
    children,
  };
}

type BranchSummaryMeta = {
  abandonedTip: string;
  forkId: string | null;
  messageCount: number;
};

function readBranchSummaryMeta(toolResults: unknown): BranchSummaryMeta | null {
  if (!toolResults || typeof toolResults !== "object") return null;
  const meta = (toolResults as { branchSummary?: BranchSummaryMeta }).branchSummary;
  if (!meta || typeof meta.abandonedTip !== "string") return null;
  return meta;
}

/** 复用 autoCompact 摘要管道风格，生成旁路分支摘要文本 */
export async function summarizeAbandonedBranch(
  config: AppConfig,
  model: string,
  abandoned: Array<{ role: string; content: string }>,
): Promise<string | null> {
  if (abandoned.length === 0) return null;
  const transcript = abandoned
    .map((m) => {
      const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
      return `[${role}]\n${m.content.slice(0, 2000)}`;
    })
    .join("\n\n---\n\n");
  const summaryModel = resolveCompactSummaryModel(config, model);
  try {
    const summary = await resilientChatCompletion({
      config,
      model: summaryModel,
      messages: [
        {
          role: "system",
          content:
            "你是 KnowPilot 分支摘要助手。将以下被放弃的对话分支压缩为简洁中文摘要，保留：用户目标、已做决策、工具结果要点、未完成任务。不要编造。",
        },
        {
          role: "user",
          content: `请摘要以下被切换离开的对话分支：\n\n${transcript.slice(0, 32000)}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });
    return summary.content?.trim() || null;
  } catch (err) {
    console.warn(
      "[chatTree] branch_summary 生成失败，跳过:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type SwitchBranchResult = {
  switched: boolean;
  activeLeafId: string;
  summaryGenerated: boolean;
  summaryReused: boolean;
};

export async function switchBranch(
  prisma: PrismaClient,
  config: AppConfig,
  input: { sessionId: string; messageId: string; model?: string },
): Promise<SwitchBranchResult> {
  const session = await prisma.chatSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, activeLeafId: true, model: true },
  });
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: `会话不存在：${input.sessionId}` });
  }

  const target = await prisma.chatMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, sessionId: true },
  });
  if (!target || target.sessionId !== input.sessionId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `messageId 不属于该会话或不存在：session=${input.sessionId} message=${input.messageId}`,
    });
  }

  if (session.activeLeafId === input.messageId) {
    return {
      switched: false,
      activeLeafId: input.messageId,
      summaryGenerated: false,
      summaryReused: false,
    };
  }

  const all = await prisma.chatMessage.findMany({
    where: { sessionId: input.sessionId },
    orderBy: { createdAt: "asc" },
  });

  const oldLeaf = session.activeLeafId;
  const lca = findLcaId(all, oldLeaf, input.messageId);
  const oldPath = resolveActivePath(all, oldLeaf);
  const lcaIdx = lca ? oldPath.findIndex((m) => m.id === lca) : -1;
  const abandoned = (lcaIdx >= 0 ? oldPath.slice(lcaIdx + 1) : oldPath).filter(
    (m) => m.kind !== BRANCH_SUMMARY_KIND,
  );

  let summaryGenerated = false;
  let summaryReused = false;

  if (abandoned.length > 0 && oldLeaf) {
    const existing = all.filter(
      (m) => m.kind === BRANCH_SUMMARY_KIND && (m.parentId ?? null) === (lca ?? null),
    );
    const reusable = existing.find((m) => {
      const meta = readBranchSummaryMeta(m.toolResults);
      return meta?.abandonedTip === oldLeaf;
    });

    if (reusable) {
      summaryReused = true;
    } else {
      const body = await summarizeAbandonedBranch(
        config,
        input.model ?? session.model ?? "deepseek-v4-flash",
        abandoned.map((m) => ({ role: m.role, content: m.content })),
      );
      if (body) {
        const meta: BranchSummaryMeta = {
          abandonedTip: oldLeaf,
          forkId: lca,
          messageCount: abandoned.length,
        };
        await appendChatMessage(
          prisma,
          {
            sessionId: input.sessionId,
            role: "system",
            content: `${BRANCH_SUMMARY_MARKER}\n${body}`,
            parentId: lca,
            kind: BRANCH_SUMMARY_KIND,
            source: "system",
            toolResults: { branchSummary: meta },
          },
          { advanceLeaf: false },
        );
        summaryGenerated = true;
      }
    }
  }

  await prisma.chatSession.update({
    where: { id: input.sessionId },
    data: { activeLeafId: input.messageId },
  });

  return {
    switched: true,
    activeLeafId: input.messageId,
    summaryGenerated,
    summaryReused,
  };
}

export async function setMessageLabel(
  prisma: PrismaClient,
  input: { messageId: string; label: string | null },
): Promise<ChatTreeMessage> {
  const existing = await prisma.chatMessage.findUnique({ where: { id: input.messageId } });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: `消息不存在：${input.messageId}` });
  }
  const updated = await prisma.chatMessage.update({
    where: { id: input.messageId },
    data: { label: input.label },
  });
  return updated as ChatTreeMessage;
}
