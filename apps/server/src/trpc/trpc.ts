/**
 * tRPC 初始化 — 定义 procedure 和 middleware
 */

import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

/** 创建 router */
export const router = t.router;

/** 公开 procedure (无需认证，单用户模式全部用这个) */
export const publicProcedure = t.procedure;

/** middleware 工具 */
export const middleware = t.middleware;
