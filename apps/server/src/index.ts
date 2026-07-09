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
import { recoverStaleAsyncJobs, cleanupDeliveredAsyncJobs } from "./infra/asyncJobManager.js";
import { closeBrowser } from "./infra/metablog/webScraper.js";
import { getSharedBrowser } from "./infra/metablog/browserPool.js";
import { hasSystemChrome } from "./infra/metablog/playwrightChrome.js";
import { syncSearchEnvFromConfig } from "./infra/nativeTools.js";
import { getEnrichedServerCapabilities, getServerCapabilities } from "./infra/capabilities.js";
import { handleAgentChatStream } from "./infra/agentStream.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";
import { assertCredentialEncryptionAvailable } from "./infra/credentialVault.js";
import { ensureIntegrationCredentialsInjected } from "./infra/credentialVault.js";
import { isAuthEnabled, verifyAuthHeader } from "./infra/auth.js";
import { prisma } from "./db.js";

const app = express();

// 优先加载 monorepo 根目录 .env
loadRootEnv();

// 初始化配置、事件总线、Service容器、触发器引擎
const config = getAppConfig();
syncSearchEnvFromConfig(config);
const eventBus = getEventBus();
const services = getServiceContainer(prisma, eventBus, config);
// P1：启动时尽早注入一次集成凭据到 config.integrations，后续请求零工作；
// 凭据 CRUD 后由 invalidateIntegrationCredentials 标记失效，下次请求惰性重注入。
void ensureIntegrationCredentialsInjected(config, prisma).catch((err) => {
  console.warn("  ⚠️ [Credentials] 启动注入失败，将退回首次请求时注入:", err instanceof Error ? err.message : err);
});
const triggerEngine = getTriggerEngine(prisma, eventBus, services);
const taskScheduler = getTaskScheduler(prisma, services);

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
app.get("/health", async (_req, res) => {
  try {
    const capabilities = await getEnrichedServerCapabilities(config, () =>
      services.infoSource.list({ page: 1, pageSize: 1, enabled: true }),
    );
    res.json({
      status: "ok",
      timestamp: Date.now(),
      capabilities,
    });
  } catch (err: unknown) {
    res.status(503).json({
      status: "error",
      timestamp: Date.now(),
      capabilities: getServerCapabilities(config),
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// 文章本地资源（图片等）静态服务
// P1-1：AUTH_MODE=password 时静态资源也走鉴权，避免 /uploads、/api/posts/assets 裸奔
const staticAuthMiddleware = (req: any, res: any, next: any) => {
  if (!isAuthEnabled(config)) return next();
  if (verifyAuthHeader(config, req.headers.authorization)) return next();
  res.status(401).json({ error: "UNAUTHORIZED", message: "静态资源需鉴权，请提供 Bearer Token。" });
  return;
};
if (fs.existsSync(postsDir)) {
  app.use("/api/posts/assets", staticAuthMiddleware, express.static(postsDir));
}

// 上传文件静态服务
app.use("/uploads", staticAuthMiddleware, express.static(uploadsDir));

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

  // 凭据加密护栏：生产模式无 CREDENTIAL_MASTER_KEY 拒启动；开发模式 warn
  assertCredentialEncryptionAvailable();

  // P1-1：鉴权护栏 —— AUTH_TOKEN 回退为 AUTH_PASSWORD 时 warn（token 与密码同值，无轮换）
  if (isAuthEnabled(config) && config.auth.token === config.auth.password) {
    console.warn(
      "  ⚠️ [安全] AUTH_TOKEN 未显式设置，回退为 AUTH_PASSWORD（同值、无轮换）。生产环境建议单独设置 AUTH_TOKEN。",
    );
  }

  // Mock 模式护栏：警告混合启用导致的「假 LLM + 真工具」静默降级
  const mockFlags = {
    LLM: process.env.MOCK_LLM === "true",
    MCP: process.env.MOCK_MCP === "true",
    NATIVE_TOOLS: process.env.MOCK_NATIVE_TOOLS === "true",
  };
  const enabledMocks = Object.entries(mockFlags).filter(([, v]) => v).map(([k]) => k);
  if (enabledMocks.length > 0) {
    const missing = Object.entries(mockFlags).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      console.warn(
        `  ⚠️ [Mock] 已启用 ${enabledMocks.join(",")}，但未启用 ${missing.join(",")}。` +
          `这会导致「假 LLM 回复 + 真实工具触网」的混合态，生产环境请勿如此配置。`,
      );
    } else {
      console.warn(`  🧪 [Mock] 全部 Mock 开关已启用 (LLM/MCP/NATIVE_TOOLS) — 服务运行在测试模式，不调用任何真实外部 API。`);
    }
  }

  // listen 后再启后台任务；FTS 仅由 pnpm db:sync / sync:watch 重建
  triggerEngine.start().catch((err) => {
    console.error("❌ [TriggerEngine] 启动失败:", err);
  });
  taskScheduler.start().catch((err) => {
    console.error("❌ [TaskScheduler] 启动失败:", err);
  });
  // Swarm 初始化：首次启动自动创建超级 Agent（幂等）
  import("./infra/swarmInitializer.js")
    .then(({ initSwarm }) => initSwarm(prisma))
    .then(() => import("./infra/heartbeatEngine.js"))
    .then(({ getHeartbeatEngine }) => getHeartbeatEngine(prisma, services, config).start())
    .catch((err) => console.error("❌ [Swarm] 初始化/心跳启动失败:", err));
  recoverStaleAsyncJobs()
    .then((n) => {
      if (n > 0) console.log(`  ⚠️ [AsyncJobs] 已将 ${n} 个中断的后台任务标为 failed`);
    })
    .catch((err) => {
      console.error("❌ [AsyncJobs] 恢复检查失败:", err);
    });
  cleanupDeliveredAsyncJobs()
    .then((n) => {
      if (n > 0) console.log(`  🧹 [AsyncJobs] 已清理 ${n} 条过期已投递任务`);
    })
    .catch((err) => {
      console.error("❌ [AsyncJobs] 清理过期任务失败:", err);
    });

  if (hasSystemChrome() && process.env.BROWSER_WARMUP !== "0") {
    void getSharedBrowser()
      .then(() => console.log("  🌐 [Browser] Playwright 共享实例已预热"))
      .catch((err) => console.warn("  ⚠️ [Browser] 预热失败:", err instanceof Error ? err.message : err));
  }
});

// 优雅退出处理
const handleShutdown = () => {
  console.log("\n  💾 [Shutdown] 正在关闭服务，清理资源...");
  triggerEngine.stop();
  void closeBrowser().catch(() => undefined);
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


