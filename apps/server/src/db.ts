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
  void prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {
    /* 非 SQLite 或只读时忽略 */
  });
}
