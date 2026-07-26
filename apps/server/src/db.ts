/**
 * Prisma 客户端单例
 *
 * 确保在开发模式下热重载不会创建多个连接。
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; prismaWal: boolean };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** 开发模式下启用 WAL，减轻 sync:watch 与 server 并发写锁 */
if (!globalForPrisma.prismaWal) {
  globalForPrisma.prismaWal = true;
  prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {
    /* 非 SQLite 或只读时忽略 */
  });
  // busy_timeout=15s：SQLite 默认 0（锁竞争立即抛 SQLITE_BUSY → Prisma P1008 socket timeout）。
  // SSE 事件持久化、chatTree 事务、service 更新高并发写时，写锁排队等不到就 P1008/P2034。
  // 设 15s 让等锁方排队等待而非立即失败，配合 WAL 显著降低并发写失败。
  prisma.$queryRawUnsafe("PRAGMA busy_timeout=15000;").catch(() => {
    /* 非 SQLite 时忽略 */
  });
}
