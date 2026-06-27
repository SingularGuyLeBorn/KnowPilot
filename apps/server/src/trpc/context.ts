/**
 * tRPC Context — 每个请求的上下文对象
 *
 * 注入 Prisma client，后续可扩展注入用户信息等。
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { prisma } from "../db.js";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    prisma,
  };
}

/** 用于单元测试的内部 context 创建（不依赖 HTTP 请求） */
export async function createContextInner() {
  return {
    prisma,
  };
}

export type Context = {
  prisma: typeof prisma;
};

