/**
 * KnowPilot Server — Express + tRPC 入口
 */

import "dotenv/config";
import fs from "fs";
import express from "express";
import cors from "cors";
import compression from "compression";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router.js";
import { createContext } from "./trpc/context.js";
import { getAppConfig, loadRootEnv } from "./infra/config.js";
import { getEventBus } from "./infra/eventBus.js";
import { getServiceContainer } from "./infra/serviceContainer.js";
import { getTriggerEngine } from "./infra/triggerEngine.js";
import { getTaskScheduler } from "./infra/taskScheduler.js";
import {
  recoverStaleRuns,
  cleanupDeliveredAsyncJobs,
  wireAsyncJobPush,
  startAsyncDeliveryReconciler,
  stopAsyncDeliveryReconciler,
  runStartupRecovery,
} from "./infra/asyncJobManager.js";
import { closeSharedBrowser } from "./infra/metablog/browserPool.js";
import { getSharedBrowser } from "./infra/metablog/browserPool.js";
import { hasSystemChrome } from "./infra/metablog/playwrightChrome.js";
import { syncSearchEnvFromConfig } from "./infra/nativeTools.js";
import { getServerCapabilities, getCachedEnrichedServerCapabilities } from "./infra/capabilities.js";
import { handleAgentChatStream, handleAgentChatStop } from "./infra/agentStream.js";
import { SessionStreamHub, setStreamHub } from "./infra/sessionStreamHub.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";
import { assertCredentialEncryptionAvailable } from "./infra/credentialVault.js";
import { ensureIntegrationCredentialsInjected } from "./infra/credentialVault.js";
import { isAuthEnabled, verifyAuthHeader } from "./infra/auth.js";
import { prisma } from "./db.js";
import { hydrateLlmBudget } from "./infra/llmBudget.js";

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

// P9：gzip/deflate 压缩大响应（session 详情、post 内容等）。排除 SSE（text/event-stream），
// 避免压缩缓冲破坏流式实时性。
app.use(
  compression({
    filter: (req, res) => {
      const ct = res.getHeader("Content-Type");
      if (typeof ct === "string" && ct.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  }),
);

// 健康检查 (非 tRPC)
app.get("/health", async (_req, res) => {
  // P10：保留轻量 DB 连通性检查（DB 挂时返回 503），capabilities 走缓存避免每次查 DB
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err: unknown) {
    res.status(503).json({
      status: "error",
      timestamp: Date.now(),
      capabilities: getServerCapabilities(config),
      message: err instanceof Error ? err.message : "DB 连通性检查失败",
    });
    return;
  }
  try {
    const capabilities = await getCachedEnrichedServerCapabilities(config, prisma);
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
const streamHub = new SessionStreamHub(config.stream);
setStreamHub(streamHub);
wireAsyncJobPush(config);
app.post(
  "/api/agent/chat/stream",
  handleAgentChatStream(services, config, createTrpcInvoker({ services }), streamHub),
);
app.get(
  "/api/agent/chat/stream",
  handleAgentChatStream(services, config, createTrpcInvoker({ services }), streamHub),
);
app.post("/api/agent/chat/stop", handleAgentChatStop(streamHub));

// AgentMail（agentmail.to）入站 webhook —— ask_user 邮件答复
app.post("/api/webhooks/agentmail", async (req, res) => {
  const { verifyAgentMailWebhook, extractReplyTextFromWebhook } = await import(
    "./infra/agentMailClient.js"
  );
  const { resolveAskUserFromMail, getAskUserPending } = await import("./infra/askUserGate.js");

  if (!verifyAgentMailWebhook({ headers: req.headers as Record<string, string | string[] | undefined> })) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "webhook 验签失败" });
    return;
  }

  const payload = req.body as {
    event_type?: string;
    event_id?: string;
    message?: {
      message_id?: string;
      thread_id?: string;
      in_reply_to?: string;
      extracted_text?: string;
      text?: string;
      preview?: string;
    };
  };

  if (payload.event_type && payload.event_type !== "message.received") {
    res.json({ ok: true, ignored: true, reason: `event_type=${payload.event_type}` });
    return;
  }

  const text = extractReplyTextFromWebhook(payload);
  if (!text) {
    res.json({ ok: true, ignored: true, reason: "empty body" });
    return;
  }

  const resolved = resolveAskUserFromMail({
    eventId: payload.event_id,
    inReplyTo: payload.message?.in_reply_to,
    threadId: payload.message?.thread_id,
    text,
  });

  if (!resolved.ok) {
    res.json({ ok: true, matched: false, reason: resolved.reason });
    return;
  }

  const pending = getAskUserPending(resolved.askId);
  if (pending?.sessionId) {
    streamHub.pushExternalEvent(pending.sessionId, {
      type: "ask_user_resolved",
      sessionId: pending.sessionId,
      askId: resolved.askId,
      outcome: "answered",
    });
  }

  res.json({ ok: true, matched: true, askId: resolved.askId });
});

// 异步任务推送 SSE（独立于 Agent 运行流，用于推优先的 async_delivery 事件）
app.get("/api/agent/async-stream", (req, res) => {
  const sessionId = String(req.query.sessionId || "");
  if (!sessionId) {
    res.status(400).json({ error: "缺少 sessionId" });
    return;
  }
  // EventSource 无法设 Authorization header，允许 ?token= 兜底
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const authHeader =
    req.headers.authorization || (queryToken ? `Bearer ${queryToken}` : undefined);
  if (isAuthEnabled(config) && !verifyAuthHeader(config, authHeader)) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "未授权" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const unsubscribe = streamHub.subscribeExternal(sessionId, (event) => {
    if (!res.destroyed) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });

  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(": keepalive\n\n");
  }, 5000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.destroyed) res.end();
  });
});

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

// C5：启动期 await 预算 hydrate（同日 max 合并，不丢已花额度）后再接流量
await hydrateLlmBudget(config.projectRoot).catch((err) => {
  console.error("❌ [llmBudget] 启动 hydrate 失败（将以内存零消耗继续）:", err);
});

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

  // Goal 外环：hub run settled → 若有 pendingContinue 则起下一轮（显式事件，非定时器）
  import("./infra/goalLoop.js")
    .then(({ registerGoalLoopSettledHook }) => {
      registerGoalLoopSettledHook(services, config);
    })
    .catch((err) => console.error("❌ [GoalLoop] 挂载 settled 钩子失败:", err));

  // listen 后再启后台任务；FTS 仅由 pnpm db:sync / sync:watch 重建
  triggerEngine.start().catch((err) => {
    console.error("❌ [TriggerEngine] 启动失败:", err);
  });
  taskScheduler.start().catch((err) => {
    console.error("❌ [TaskScheduler] 启动失败:", err);
  });
  // Swarm 初始化：首次启动自动创建系统 Workspace + 超级 Agent（幂等）
  import("./infra/swarmInitializer.js")
    .then(({ initSwarm }) => initSwarm(prisma, services, config))
    .then(() => import("./infra/heartbeatEngine.js"))
    .then(({ getHeartbeatEngine }) => {
      heartbeatEngineRef = getHeartbeatEngine(prisma, services, config);
      return heartbeatEngineRef.start();
    })
    .catch((err) => console.error("❌ [Swarm] 初始化/心跳启动失败:", err));
  // R-2 重启恢复首扫（四动作，条件写幂等，DB 为 ground truth）：僵尸 Task→failed（不自动重跑）
  // + 僵尸 running 会话→paused + superior 孤儿队列项重注册 drain + 未投递终态/孤儿交付合并对账
  // （动作 2 与 R-1 reconciler 同一幂等入口；周期对账由下方 startAsyncDeliveryReconciler 负责）
  runStartupRecovery({ config, services })
    .then((r) => {
      if (r.staleTasksFailed > 0) console.log(`  ⚠️ [AsyncJobs] 已将 ${r.staleTasksFailed} 个中断的后台任务标为 failed`);
      if (r.zombieSessionsPaused > 0) console.log(`  ⚠️ [Session] 已将 ${r.zombieSessionsPaused} 个僵尸 running 会话标为 paused`);
      if (r.superiorDrainsRegistered > 0) console.log(`  ♻️ [Session] 已为 ${r.superiorDrainsRegistered} 个会话重注册 superior 队列 drain`);
      const healed = r.reconcile.renotified + r.reconcile.renotifiedUndelivered;
      if (healed > 0) {
        console.log(`  ♻️ [reconciler] 启动首扫补投 ${healed} 条交付（孤儿回滚 ${r.reconcile.rolledBack} / 未投递 ${r.reconcile.renotifiedUndelivered}）`);
      }
    })
    .catch((err) => {
      console.error("❌ [StartupRecovery] 启动恢复失败:", err);
    });
  // W11：遗留 running Run 标 interrupted（如实声明不续跑；与 recoverStaleAsyncJobs 同款启动挂载点）
  recoverStaleRuns()
    .then((n) => {
      if (n > 0) console.log(`  ⚠️ [Run] 已将 ${n} 个中断的运行标为 interrupted`);
    })
    .catch((err) => {
      console.error("❌ [Run] 中断恢复检查失败:", err);
    });
  // ask_user：从 SQLite 恢复 pending（提醒重挂；无 waiter 时答复走会话队列孤儿投递）
  import("./infra/askUserGate.js")
    .then(({ hydrateAskUserGateFromDb }) => hydrateAskUserGateFromDb(config, services))
    .then((n) => {
      if (n > 0) console.log(`  ♻️ [ask_user] 已恢复 ${n} 条 pending 提问`);
    })
    .catch((err) => {
      console.error("❌ [ask_user] hydrate 失败:", err);
    });
  import("./infra/approvalGate.js")
    .then(({ expireStaleApprovals }) => expireStaleApprovals(services))
    .then((n) => {
      if (n > 0) console.log(`  ⚠️ [Approval] 已将 ${n} 条过期 pending 审批标为 rejected`);
    })
    .catch((err) => {
      console.error("❌ [Approval] 过期清理失败:", err);
    });
  cleanupDeliveredAsyncJobs()
    .then((n) => {
      if (n > 0) console.log(`  🧹 [AsyncJobs] 已清理 ${n} 条过期已投递任务`);
    })
    .catch((err) => {
      console.error("❌ [AsyncJobs] 清理过期任务失败:", err);
    });
  // R-1 S3：投递对账者——启动即扫一轮 + 周期扫（周期 = stream.cleanupIntervalMs 量级），
  // 兜底「认领了但气泡没进会话」的孤儿交付（回滚 delivered + 重新走 notify/autoConsume）
  startAsyncDeliveryReconciler(config, services);

  // 免费 API Key：默认启动即同步（freellm GitHub + OpenRouter :free），FREE_KEYS_AUTO_SYNC=0 关闭
  import("./infra/freeKeysSync.js")
    .then(({ startFreeKeysAutoSync }) => startFreeKeysAutoSync(prisma, config))
    .catch((err) => console.warn("  ⚠️ [freeKeysSync] 启动失败:", err instanceof Error ? err.message : err));

  if (hasSystemChrome() && process.env.BROWSER_WARMUP !== "0") {
    void getSharedBrowser()
      .then(() => console.log("  🌐 [Browser] Playwright 共享实例已预热"))
      .catch((err) => console.warn("  ⚠️ [Browser] 预热失败:", err instanceof Error ? err.message : err));
  }
});

// 优雅退出处理
let heartbeatEngineRef: { start: () => void; stop: () => void } | null = null;
const handleShutdown = () => {
  console.log("\n  💾 [Shutdown] 正在关闭服务，清理资源...");
  triggerEngine.stop();
  taskScheduler.stop();
  heartbeatEngineRef?.stop();
  stopAsyncDeliveryReconciler();
  void import("./infra/freeKeysSync.js").then(({ stopFreeKeysAutoSync }) => stopFreeKeysAutoSync());
  streamHub.destroy();
  void closeSharedBrowser().catch(() => undefined);
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
export type { AsyncQueueStats } from "./infra/asyncJobManager.js";


