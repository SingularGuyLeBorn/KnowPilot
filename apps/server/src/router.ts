/**
 * tRPC AppRouter 导出
 *
 * 本文件只导出 router 类型和实例，不启动 HTTP 服务。
 * 供前端通过 @knowpilot/server/router 进行类型安全的 tRPC 调用。
 */

import { appRouter } from "./trpc/router.js";

export { appRouter };
export type AppRouter = typeof appRouter;
