/**
 * KnowPilot Server — Express + tRPC 入口
 */

import "dotenv/config";
import fs from "fs";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router.js";
import { createContext } from "./trpc/context.js";
import { getAppConfig, loadRootEnv } from "./infra/config.js";
import { getEventBus } from "./infra/eventBus.js";
import { getServiceContainer } from "./infra/serviceContainer.js";
import { getTriggerEngine } from "./infra/triggerEngine.js";
import { getTaskScheduler } from "./infra/taskScheduler.js";
import { rebuildFtsIndex } from "./infra/ftsIndex.js";
import { prisma } from "./db.js";
import { handleAgentChatStream } from "./infra/agentStream.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";

const app = express();

// 优先加载 monorepo 根目录 .env
loadRootEnv();

// 初始化配置、事件总线、Service容器、触发器引擎
const config = getAppConfig();
const eventBus = getEventBus();
const services = getServiceContainer(prisma, eventBus, config);
const triggerEngine = getTriggerEngine(prisma, eventBus, services);
const taskScheduler = getTaskScheduler(prisma, services);

// 启动事件触发器引擎与定时任务调度器
triggerEngine.start().catch((err) => {
  console.error("❌ [TriggerEngine] 启动失败:", err);
});
taskScheduler.start().catch((err) => {
  console.error("❌ [TaskScheduler] 启动失败:", err);
});
rebuildFtsIndex(prisma).catch((err) => {
  console.error("❌ [FTS] 索引重建失败:", err);
});

const PORT = config.port;
const postsDir = config.contentPaths.posts;
const uploadsDir = config.uploadDir;

// CORS — 支持 PUBLIC_URL / CORS_ORIGINS（Cloudflare Tunnel 远程访问）
const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
];
const corsOrigins = [
  ...new Set([
    ...defaultOrigins,
    ...(config.publicUrl ? [config.publicUrl] : []),
    ...config.corsOrigins,
  ]),
];
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  }),
);

// JSON body 解析
app.use(express.json({ limit: "10mb" }));

// 健康检查 (非 tRPC)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// 文章本地资源（图片等）静态服务
if (fs.existsSync(postsDir)) {
  app.use("/api/posts/assets", express.static(postsDir));
}

// 上传文件静态服务
app.use("/uploads", express.static(uploadsDir));

// Agent 流式聊天 SSE（不走 tRPC，避免 buffering）
app.post(
  "/api/agent/chat/stream",
  handleAgentChatStream(services, config, createTrpcInvoker({ services })),
);

// tRPC 挂载
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path }) {
      console.error(`[tRPC Error] ${path}:`, error.message);
    },
  })
);

// 启动
const server = app.listen(PORT, () => {
  console.log(`\n  🚀 KnowPilot Server running at http://localhost:${PORT}`);
  console.log(`  📡 tRPC endpoint: http://localhost:${PORT}/api/trpc`);
  console.log(`  💚 Health check:  http://localhost:${PORT}/health\n`);
});

// 优雅退出处理
const handleShutdown = () => {
  console.log("\n  💾 [Shutdown] 正在关闭服务，清理资源...");
  triggerEngine.stop();
  server.close(() => {
    prisma.$disconnect().then(() => {
      console.log("  👋 [Shutdown] 数据库连接已断开，服务正常退出。");
      process.exit(0);
    });
  });
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

export type { AppRouter } from "./router.js";


