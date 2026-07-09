/**
 * tRPC 初始化 — 定义 procedure 和 middleware
 */

import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { isAuthEnabled, verifyAuthHeader } from "../infra/auth.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    let cause: any = error.cause || {};
    let message = error.message;
    let dataCode = shape.data.code;

    // 1. Zod 校验错误格式化
    if (error.cause instanceof ZodError) {
      const zodErr = error.cause;
      dataCode = "BAD_REQUEST";
      message = `参数校验失败：${zodErr.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("；")}`;
      cause = {
        reason: "VALIDATION_ERROR",
        issues: zodErr.errors.map(e => ({
          field: e.path.join("."),
          message: e.message
        })),
        suggestion: "请检查输入的参数格式和必填项，修正后重试。",
      };
    } 
    // 2. Prisma 数据库错误格式化
    else if (error.cause instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaErr = error.cause;
      if (prismaErr.code === "P2002") {
        dataCode = "CONFLICT";
        message = `操作冲突：存在冲突的唯一字段值。`;
        cause = {
          reason: "UNIQUE_CONSTRAINT_VIOLATION",
          target: prismaErr.meta?.target,
          suggestion: "请使用唯一的名称或标识，或者对已有记录进行修改操作。",
        };
      } else {
        dataCode = "INTERNAL_SERVER_ERROR";
        cause = {
          reason: "DATABASE_ERROR",
          prismaCode: prismaErr.code,
          meta: prismaErr.meta,
          suggestion: "数据库内部操作异常，请检查输入或重试。",
        };
      }
    }

    return {
      ...shape,
      message,
      data: {
        ...shape.data,
        code: dataCode,
        cause,
      },
    };
  },
});

const loggerMiddleware = t.middleware(async (opts) => {
  const start = Date.now();
  const path = opts.path;
  const type = opts.type;

  const result = await opts.next();
  const durationMs = Date.now() - start;

  // P3：query 不记日志，跳过 getRawInput 以避免每个查询的无谓开销。
  if (type !== "mutation") return result;

  // 仅 mutation 取 rawInput（用于 ai.invoke 的 tool 元数据）
  let rawInput: unknown;
  try {
    rawInput = await opts.getRawInput();
  } catch {
    rawInput = undefined;
  }

  const component = path === "ai.invoke" ? "ai.call" : path.split(".")[0] || "unknown";
  const baseMeta: Record<string, unknown> = { durationMs, type };
  if (path === "ai.invoke" && rawInput && typeof rawInput === "object" && "tool" in rawInput) {
    baseMeta.tool = (rawInput as { tool?: string }).tool;
    baseMeta.success = result.ok;
  }

  if (result.ok) {
    // P2：成功审计日志改 fire-and-forget，不阻塞请求关键路径。
    void opts.ctx.prisma.log
      .create({
        data: {
          level: "info",
          component,
          event: path,
          message:
            path === "ai.invoke" && baseMeta.tool
              ? `AI 调用 ${baseMeta.tool} 成功 (${durationMs}ms)`
              : `${path} 执行成功 (${durationMs}ms)`,
          metadata: JSON.stringify(baseMeta),
        },
      })
      .catch((err) => {
        // 日志写入失败不影响业务，但记录到 stderr 便于发现 Prisma 临时断开等问题（#14）
        console.error("[loggerMiddleware] 审计日志写入失败:", err instanceof Error ? err.message : err);
      });
  } else {
    // 错误日志保留同步写入，确保可靠性（崩溃前能落库）
    try {
      await opts.ctx.prisma.log.create({
        data: {
          level: "error",
          component,
          event: `${path}.failed`,
          message:
            path === "ai.invoke" && baseMeta.tool
              ? `AI 调用 ${baseMeta.tool} 失败 (${durationMs}ms)`
              : `${path} 执行失败 (${durationMs}ms)`,
          metadata: JSON.stringify({ ...baseMeta, success: false }),
        },
      });
    } catch {
      // 日志写入失败不影响业务
    }
  }

  return result;
});

const authGuard = t.middleware(async ({ ctx, next, path }) => {
  if (!isAuthEnabled(ctx.config)) return next();
  if (path === "auth.status" || path === "auth.login") return next();
  const header = ctx.req?.headers?.authorization;
  if (verifyAuthHeader(ctx.config, header)) return next();
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "未授权：请先登录后再访问控制台 API。",
  });
});

/** 创建 router */
export const router = t.router;

/** 公开 procedure（AUTH_MODE=password 时仍需 Token，auth.* 除外） */
export const publicProcedure = t.procedure.use(loggerMiddleware).use(authGuard);

/** middleware 工具 */
export const middleware = t.middleware;

