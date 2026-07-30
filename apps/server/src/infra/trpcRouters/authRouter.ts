/**
 * auth tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { TRPCError } from "@trpc/server";
import { authLoginSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { success } from "../../trpc/result.js";
import {
  getRemoteAccessInfo,
  isAuthEnabled,
  loginWithPassword,
  verifyAuthHeader,
} from "../auth.js";

export const authRouter = router({
  status: publicProcedure
    .meta({ description: "鉴权与远程访问配置状态。", aiReadable: false })
    .query(({ ctx }) => ({
      enabled: isAuthEnabled(ctx.config),
      authenticated: verifyAuthHeader(ctx.config, ctx.req?.headers?.authorization),
      remote: getRemoteAccessInfo(ctx.config),
    })),
  login: publicProcedure
    .meta({ description: "密码登录，返回 Bearer Token。", aiReadable: false })
    .input(authLoginSchema)
    .mutation(({ ctx, input }) => {
      const result = loginWithPassword(ctx.config, input.password);
      if (!result) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误，请重试。" });
      }
      return success({ data: result, operation: "login", entity: "auth" });
    }),
});

