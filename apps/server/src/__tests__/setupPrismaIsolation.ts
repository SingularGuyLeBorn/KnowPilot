/**
 * 单 fork 串行套件：PrismaClient 单例上的 $transaction 若被 vi.spyOn 弄坏，
 * mockRestore 后可能变成非函数，后续全套 FTS/队列/compact 全红。
 * 每测前强制复位，把「事务入口可用」收成套件不变量。
 */

import { beforeEach } from "vitest";
import { prisma } from "../db.js";

const originalTransaction = prisma.$transaction.bind(prisma);

beforeEach(() => {
  (prisma as { $transaction: typeof prisma.$transaction }).$transaction =
    originalTransaction as typeof prisma.$transaction;
});
