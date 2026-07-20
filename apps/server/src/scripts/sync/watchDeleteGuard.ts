/**
 * D4：watch unlink 与运行时 CRUD 改名窗口的并发保护
 *
 * 目标行 updatedAt 在 grace 窗口内 → 跳过本次 deleteBySlug，交由全量重扫收敛。
 */

import type { PrismaClient } from "@prisma/client";
import type { Syncer } from "./types.js";

export const WATCH_DELETE_GRACE_MS = 5000;

/** 该 slug 对应行是否在 graceMs 内刚被更新（改名窗口保护） */
export async function isWatchDeleteProtected(
  prisma: PrismaClient,
  entityName: string,
  slug: string,
  graceMs: number = WATCH_DELETE_GRACE_MS,
): Promise<boolean> {
  const since = new Date(Date.now() - graceMs);
  switch (entityName) {
    case "Post":
      return !!(await prisma.post.findFirst({
        where: { slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "Agent":
      return !!(await prisma.agent.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "Skill":
      return !!(await prisma.skill.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "McpServer":
      return !!(await prisma.mcpServer.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "Memory":
      return !!(await prisma.memory.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "Prompt":
      return !!(await prisma.prompt.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "Task":
      return !!(await prisma.task.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    case "InfoSource":
      return !!(await prisma.infoSource.findFirst({
        where: { sourceSlug: slug, updatedAt: { gte: since } },
        select: { id: true },
      }));
    default:
      return false;
  }
}

/** watch 路径受保护删除：跳过时 deleted=0 + skipped=true（调用方标记全量重扫） */
export async function guardedWatchDeleteBySlug(
  prisma: PrismaClient,
  syncer: Syncer,
  slug: string,
  graceMs: number = WATCH_DELETE_GRACE_MS,
): Promise<{ deleted: number; skipped: boolean }> {
  if (!syncer.deleteBySlug) return { deleted: 0, skipped: false };
  if (await isWatchDeleteProtected(prisma, syncer.entityName, slug, graceMs)) {
    return { deleted: 0, skipped: true };
  }
  const deleted = await syncer.deleteBySlug(prisma, slug);
  return { deleted, skipped: false };
}
