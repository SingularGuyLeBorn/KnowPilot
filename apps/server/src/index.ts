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
import { installProcessSafetyHandlers } from "./infra/processSafety.js";
import { initGlobalProxy } from "./infra/proxyDispatcher.js";

// 尽早挂安全网：Tesseract/Skill VM/第三方漏网微任务不得打死进程
installProcessSafetyHandlers();
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
import { getOcrStatus } from "./infra/ocrService.js";
import { handleAgentChatStream, handleAgentChatStop } from "./infra/agentStream.js";
import { SessionStreamHub, setStreamHub } from "./infra/sessionStreamHub.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";
import { assertCredentialEncryptionAvailable } from "./infra/credentialVault.js";
import { ensureIntegrationCredentialsInjected } from "./infra/credentialVault.js";
import { isAuthEnabled, verifyAuthHeader, assertPublicUrlAuthSafe } from "./infra/auth.js";
import { globalRateLimiter, chatStreamRateLimiter } from "./infra/rateLimit.js";
import { traceMiddleware, formatTrace } from "./infra/trace.js";
import { prisma } from "./db.js";
import { hydrateLlmBudget } from "./infra/llmBudget.js";
import { notifyPostListChanged } from "./infra/uiStateNotify.js";

const app = express();

// 信任 loopback 反代的 X-Forwarded-For：远程隧道链路为 公网→cloudflared→Next.js rewrite→127.0.0.1:3010，
// 不设 trust proxy 时所有公网请求 req.ip 都是 127.0.0.1，全局限流 / chat-stream 限流 / 管理端点本机判定全部失效。
// 仅信任 loopback 来源（Next.js dev server 跑在本机），公网直连伪造 XFF 不会生效；
// 纯本地直连无 XFF，req.ip 仍为 127.0.0.1，限流 skip 逻辑不受影响。
app.set("trust proxy", "loopback");

// 优先加载 monorepo 根目录 .env
loadRootEnv();

// 初始化全局代理（国内访问国外 LLM/站点；读 HTTPS_PROXY/KP_HTTPS_PROXY，未设则直连）
initGlobalProxy();

// 初始化配置、事件总线、Service容器、触发器引擎
const config = getAppConfig();
syncSearchEnvFromConfig(config);
// 知识 Inbox 目录（截图 drop / 微信 links.txt）
import("./infra/inbox/index.js")
  .then(({ ensureInboxDirs }) => ensureInboxDirs(config))
  .catch((err) => {
    console.warn("  ⚠️ [Inbox] 目录初始化失败:", err instanceof Error ? err.message : err);
  });
const eventBus = getEventBus();
const services = getServiceContainer(prisma, eventBus, config);
// 内容列表变更 → 推送到所有主会话（PUSH 半边；管理页仍保留 refetchInterval 兜底）
eventBus.on("post.created", () => {
  notifyPostListChanged(prisma, "post.created").catch(() => {});
});
eventBus.on("post.updated", () => {
  notifyPostListChanged(prisma, "post.updated").catch(() => {});
});
eventBus.on("post.deleted", () => {
  notifyPostListChanged(prisma, "post.deleted").catch(() => {});
});
// 种子花园 posts/knowledge/resources：补 _garden.md + DB 行
services.garden.ensureSeedGardens().catch((err) => {
  console.warn("  ⚠️ [Garden] 种子库初始化失败:", err instanceof Error ? err.message : err);
});
// P1：启动时尽早注入一次集成凭据到 config.integrations，后续请求零工作；
// 凭据 CRUD 后由 invalidateIntegrationCredentials 标记失效，下次请求惰性重注入。
ensureIntegrationCredentialsInjected(config, prisma).catch((err) => {
  console.warn("  ⚠️ [Credentials] 启动注入失败，将退回首次请求时注入:", err instanceof Error ? err.message : err);
});
const triggerEngine = getTriggerEngine(prisma, eventBus, services);
const taskScheduler = getTaskScheduler(prisma, services);

const PORT = config.port;
const HOST = config.host;
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
// rawBody：QQ/部分 webhook Ed25519 验签需要原始字节（json 解析后不可还原空白差异）
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

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

// P2 安全加固：全局限流（默认 3000 req/15min/IP，loopback 默认跳过；RATE_LIMIT_ENABLED=false 关闭）
app.use(globalRateLimiter);

// P2 可观测性：trace_id 透传/生成，写入 ALS 作用域 + 响应 header（web→server 关联排障）
app.use(traceMiddleware);

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
  chatStreamRateLimiter,
  handleAgentChatStream(services, config, createTrpcInvoker({ services }), streamHub),
);
app.get(
  "/api/agent/chat/stream",
  handleAgentChatStream(services, config, createTrpcInvoker({ services }), streamHub),
);
app.post(
  "/api/agent/chat/stop",
  chatStreamRateLimiter,
  handleAgentChatStop(streamHub, config),
);

// QQ 官方 Bot 入站 webhook（需公网 URL / pnpm remote）；Ed25519 验签 + op=13 challenge
app.post("/api/webhooks/qq", async (req, res) => {
  try {
    const { getChannelAdapter } = await import("./infra/messageGateway.js");
    const { getQqAdapterIngest, loadQqBotConfigFromEnv } = await import(
      "./infra/channels/qqOfficialBot.js"
    );
    const { gateQqWebhook } = await import("./infra/channels/webhookVerify.js");
    const adapter = getChannelAdapter("qq");
    if (!adapter?.enabled) {
      res.status(503).json({ error: "QQ Bot 未启用（需 QQ_BOT_APP_ID / QQ_BOT_SECRET）" });
      return;
    }
    const qqCfg = loadQqBotConfigFromEnv();
    const gate = gateQqWebhook({
      botSecret: qqCfg.secret,
      body: req.body,
      rawBody: (req as express.Request & { rawBody?: Buffer }).rawBody,
      signatureHex: String(req.headers["x-signature-ed25519"] ?? ""),
      timestamp: String(req.headers["x-signature-timestamp"] ?? ""),
    });
    if (gate.kind === "challenge") {
      res.status(200).json({ plain_token: gate.plain_token, signature: gate.signature });
      return;
    }
    if (gate.kind === "reject") {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    const ingest = getQqAdapterIngest(adapter);
    if (!ingest) {
      res.status(500).json({ error: "QQ adapter 无 ingest" });
      return;
    }
    res.status(202).json({ ok: true });
    const result = ingest(req.body);
    if (!result.ok) {
      console.warn(`[qq webhook] 忽略: ${result.error}`);
    }
  } catch (err) {
    console.error("[qq webhook]", err);
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
});

// 飞书机器人事件订阅（URL 验证 + im.message.receive_v1）
// 飞书后台 → 事件订阅 → 请求地址 https://<公网>/api/webhooks/feishu
app.post("/api/webhooks/feishu", async (req, res) => {
  try {
    const { getChannelAdapter } = await import("./infra/messageGateway.js");
    const { getFeishuAdapterIngest, loadFeishuBotConfigFromEnv } = await import(
      "./infra/channels/feishuBot.js"
    );
    const { prepareFeishuWebhookBody } = await import("./infra/channels/webhookVerify.js");
    const adapter = getChannelAdapter("feishu");
    if (!adapter?.enabled) {
      res.status(503).json({
        error: "飞书 Bot 未启用（需 FEISHU_APP_ID / FEISHU_APP_SECRET；可用 FEISHU_BOT_ENABLED=false 关闭）",
      });
      return;
    }
    const feishuCfg = loadFeishuBotConfigFromEnv();
    const prepared = prepareFeishuWebhookBody({
      encryptKey: feishuCfg.encryptKey,
      body: req.body,
      rawBody: (req as express.Request & { rawBody?: Buffer }).rawBody,
      timestamp: String(req.headers["x-lark-request-timestamp"] ?? ""),
      nonce: String(req.headers["x-lark-request-nonce"] ?? ""),
      signature: String(req.headers["x-lark-signature"] ?? ""),
    });
    if (!prepared.ok) {
      res.status(prepared.status).json({ error: prepared.error });
      return;
    }
    const ingest = getFeishuAdapterIngest(adapter);
    if (!ingest) {
      res.status(500).json({ error: "飞书 adapter 无 ingest" });
      return;
    }
    const result = ingest(prepared.body);
    // URL 验证必须同步返回 challenge
    if (result.challenge) {
      res.status(200).json({ challenge: result.challenge });
      return;
    }
    if (!result.ok) {
      console.warn(`[feishu webhook] 忽略: ${result.error}`);
      res.status(200).json({ ok: false, error: result.error });
      return;
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error("[feishu webhook]", err);
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
});

// AgentMail（agentmail.to）入站 webhook —— ask_user 邮件答复 + 审批邮件回复
// 工业级模式：快速 202 ack + 异步处理（防 AgentMail 超时重投雪崩）。
// 异步处理靠 DB 幂等（claimWebhookEvent）+ 兜底轮询保证最终一致，AgentMail 收到 202 即不重投。
app.post("/api/webhooks/agentmail", async (req, res) => {
  const { verifyAgentMailWebhook, extractReplyTextFromWebhook } = await import(
    "./infra/agentMailClient.js"
  );

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

  // 立即 202 ack，AgentMail 收到后不重投；处理异步进行（防 DB 慢 → 超时 → 重投雪崩）
  res.status(202).json({ ok: true, accepted: true, event_id: payload.event_id });

  // 异步处理：幂等抢占 → 审批/ask_user 解析 → 注入 session；失败落 DLQ
  handleAgentMailInbound(payload, text).catch((err) =>
    console.error("[agentmail webhook] 异步处理异常:", err instanceof Error ? err.message : err),
  );
});

/** webhook 异步处理体：与兜底轮询共享同款逻辑 */
async function handleAgentMailInbound(
  payload: {
    event_id?: string;
    message?: {
      message_id?: string;
      thread_id?: string;
      in_reply_to?: string;
      extracted_text?: string;
      text?: string;
      preview?: string;
    };
  },
  text: string,
): Promise<void> {
  const { resolveAskUserFromMail, getAskUserPending } = await import("./infra/askUserGate.js");
  const { resolveApprovalFromMail } = await import("./infra/approvalGate.js");
  const { claimWebhookEvent, recordDeadLetterMail } = await import("./infra/webhookIdempotency.js");

  const eventId = payload.event_id;
  if (eventId) {
    const claim = await claimWebhookEvent(prisma, eventId, "webhook", "unmatched");
    if (!claim.claimed) return; // 已处理（幂等）
  }

  // 先按审批回复解析；不匹配再按 ask_user 答复解析
  const approvalResolved = await resolveApprovalFromMail(services, {
    eventId,
    inReplyTo: payload.message?.in_reply_to,
    threadId: payload.message?.thread_id,
    text,
  });
  if (approvalResolved.ok) {
    console.info(
      `[agentmail webhook] 审批回复已注入: approvalId=${approvalResolved.approvalId} outcome=${approvalResolved.outcome}`,
    );
    return;
  }

  const resolved = resolveAskUserFromMail({
    eventId,
    inReplyTo: payload.message?.in_reply_to,
    threadId: payload.message?.thread_id,
    text,
  });

  if (!resolved.ok) {
    await recordDeadLetterMail(prisma, {
      messageId: payload.message?.message_id,
      threadId: payload.message?.thread_id,
      inReplyTo: payload.message?.in_reply_to,
      text,
      error: resolved.reason,
      source: "webhook",
    });
    return;
  }

  const pending = getAskUserPending(resolved.askId);
  if (pending?.sessionId) {
    streamHub.pushExternalEvent(pending.sessionId, {
      type: "ask_user_resolved",
      sessionId: pending.sessionId,
      askId: resolved.askId,
      outcome: "answered",
      answer: resolved.answer,
    });
  }
  console.info(`[agentmail webhook] ask_user 答复已注入: askId=${resolved.askId}`);
}

// Admin：临时隧道解析到公网 URL 后，remote.mjs 调此端点动态注册 AgentMail webhook。
// 安全：该路径被 Next.js rewrite 转发（next.config.ts），隧道开启时公网可达——
// 不设防则任何公网用户可 POST 任意 url 重注册 webhook，劫持审批/ask_user 邮件（含 APPROVE 决策）。
// AUTH 启用时强制 Bearer 校验；未启用时按真实客户端 IP（trust proxy 后）限 loopback。
app.post("/api/admin/agentmail-webhook", async (req, res) => {
  if (isAuthEnabled(config)) {
    if (!verifyAuthHeader(config, req.headers.authorization)) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "未授权：请提供 Bearer Token。" });
      return;
    }
  } else {
    const ip = req.ip || (req.socket?.remoteAddress as string | undefined) || "";
    const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!isLocal) {
      res.status(403).json({ error: "FORBIDDEN", message: "仅允许本机调用" });
      return;
    }
  }
  const body = (req.body ?? {}) as { url?: string };
  const { ensureAgentMailWebhook } = await import("./infra/agentMailClient.js");
  const result = await ensureAgentMailWebhook({ urlOverride: body.url });
  res.json(result);
});

// 异步任务推送 SSE（独立于 Agent 运行流，用于推优先的 async_delivery 事件）
// ?token= 查询串携带凭据易进浏览器历史/代理日志，仅提示一次（EventSource 无法自定义 header，保留兼容兜底）
let sseQueryTokenWarned = false;
app.get("/api/agent/async-stream", (req, res) => {
  const sessionId = String(req.query.sessionId || "");
  if (!sessionId) {
    res.status(400).json({ error: "缺少 sessionId" });
    return;
  }
  // EventSource 无法设 Authorization header，允许 ?token= 兜底
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  if (queryToken && !sseQueryTokenWarned) {
    sseQueryTokenWarned = true;
    console.warn(
      "  ⚠️ [安全] SSE 正在使用 ?token= 查询串携带凭据：URL 可能进入浏览器历史 / 代理日志 / Referer。" +
        "建议优先使用 Authorization header；仅 EventSource 不支持自定义 header 的场景保留此兜底。",
    );
  }
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
      console.error(`${formatTrace()}[tRPC Error] ${path}:`, error.message);
    },
  })
);

// C5：启动期 await 预算 hydrate（同日 max 合并，不丢已花额度）后再接流量
await hydrateLlmBudget(config.projectRoot).catch((err) => {
  console.error("❌ [llmBudget] 启动 hydrate 失败（将以内存零消耗继续）:", err);
});

// P0-01：PUBLIC_URL + 无鉴权 → 拒绝启动（除非 KP_ALLOW_INSECURE_PUBLIC=1）
try {
  assertPublicUrlAuthSafe(config);
} catch (err) {
  console.error(`\n  ❌ [安全] ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}

// 启动（默认 127.0.0.1；Docker 等设 SERVER_HOST=0.0.0.0）
const server = app.listen(PORT, HOST, () => {
  const origin = HOST === "0.0.0.0" || HOST === "::" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`\n  🚀 KnowPilot Server listening on ${HOST}:${PORT}`);
  console.log(`  📡 tRPC endpoint: ${origin}/api/trpc`);
  console.log(`  💚 Health check:  ${origin}/health\n`);

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

  // IM 通道：QQ Bot（未配凭证则跳过）
  import("./infra/channels/index.js")
    .then(({ bootstrapMessageChannels }) => bootstrapMessageChannels({ prisma, services, config }))
    .catch((err) => console.error("❌ [IM] 通道启动失败:", err));

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
    .then(() => import("./infra/agentCronEngine.js"))
    .then(({ getAgentCronEngine }) => {
      agentCronEngineRef = getAgentCronEngine(prisma, services, config);
      agentCronEngineRef.start();
    })
    .catch((err) => console.error("❌ [Swarm] 初始化/心跳/cron 启动失败:", err));
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
  // W3：刷新 pending approval decisionScope 缓存（调度面 gate 相交检查同步可读）
  import("./infra/approvalGate.js")
    .then(({ refreshPendingApprovalScopeCache }) => refreshPendingApprovalScopeCache(services))
    .then(() => import("./infra/approvalScope.js"))
    .then(({ getCachedPendingApprovalScopes }) => {
      const n = getCachedPendingApprovalScopes().length;
      if (n > 0) console.log(`  🛂 [ApprovalScope] 已加载 ${n} 条 pending decisionScope`);
    })
    .catch((err) => {
      console.warn("  ⚠️ [ApprovalScope] pending scope 缓存刷新失败:", err instanceof Error ? err.message : err);
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

  // AgentMail：启动即确保 inbox 可用 + 注册 webhook（邮件回复接收通道）+ 启动兜底轮询。
  // 未配置 AGENTMAIL_API_KEY 时跳过；未配置 PUBLIC_URL/AGENTMAIL_WEBHOOK_URL 时跳过 webhook 注册并 warn
  // （本地 localhost 不可公网访问，AgentMail 无法回调，需 Cloudflare Tunnel / ngrok 暴露公网）。
  // 兜底轮询：webhook 通道挂了（ngrok 断、server 重启中、AgentMail 投递失败）也能收到邮件回复。
  let agentMailPollerLocal: { stop: () => void } | null = null;
  import("./infra/agentMailClient.js")
    .then(async ({ isAgentMailConfigured, ensureAgentMailInbox, ensureAgentMailWebhook }) => {
      if (!isAgentMailConfigured()) return;
      const inbox = await ensureAgentMailInbox();
      if (!inbox.ok) {
        console.warn("  ⚠️ [AgentMail] inbox 未就绪:", inbox.error);
        return;
      }
      console.log(`  📧 [AgentMail] inbox ready: ${inbox.inboxId}`);
      const wh = await ensureAgentMailWebhook();
      if (!wh.ok && !wh.skipped) {
        console.warn("  ⚠️ [AgentMail] webhook 注册失败:", wh.error);
      }
      // 隧道连通性自检：注册成功后延迟 10s 从公网 ping webhook URL
      if (wh.ok) {
        const { selfCheckTunnel } = await import("./infra/agentMailClient.js");
        setTimeout(() => {
          selfCheckTunnel(wh.url)
            .then((r) => {
              if (r.ok) {
                console.log(`  ✅ [AgentMail] 隧道自检通过：公网可访问 ${wh.url}（HTTP ${r.status}）`);
              } else {
                console.warn(
                  `  ⚠️ [AgentMail] 隧道自检失败：公网无法访问 ${wh.url}（${r.error ?? `HTTP ${r.status}`}）。请检查 ngrok/Cloudflare Tunnel 是否正常运行、PUBLIC_URL 是否正确。`,
                );
              }
            })
            .catch((err) => {
              console.warn(
                "  ⚠️ [AgentMail] 隧道自检异常:",
                err instanceof Error ? err.message : err,
              );
            });
        }, 10_000);
      }
      // 兜底轮询（webhook 通道挂了的最后防线）
      const { startAgentMailPoller } = await import("./infra/agentMailPoller.js");
      agentMailPollerLocal = startAgentMailPoller({
        inboxId: inbox.inboxId,
        services,
        streamHub,
      });
      agentMailPollerRef = agentMailPollerLocal;
      console.log("  📧 [AgentMail] 兜底轮询已启动（60s 周期，webhook 挂了也能收邮件回复）");
      // webhook 健康巡检（AgentMail 侧 webhook 丢失/URL 不匹配 → 自动重注册）
      const { startAgentMailWebhookHealthCheck } = await import("./infra/agentMailClient.js");
      agentMailWebhookHealthRef = startAgentMailWebhookHealthCheck();
      console.log("  📧 [AgentMail] webhook 健康巡检已启动（5min 周期，丢失/URL 不匹配自动重注册）");
    })
    .catch((err) => console.warn("  ⚠️ [AgentMail] 启动初始化失败:", err instanceof Error ? err.message : err));

  if (hasSystemChrome() && process.env.BROWSER_WARMUP !== "0") {
    getSharedBrowser()
      .then(() => console.log("  🌐 [Browser] Playwright 共享实例已预热"))
      .catch((err) => console.warn("  ⚠️ [Browser] 预热失败:", err instanceof Error ? err.message : err));
  }

  // OCR 引擎可用性诊断（三级降级：PaddleOCR → Tesseract.js → OCR.space）
  try {
    const ocr = getOcrStatus(config);
    const paddleReady = ocr.paddleCli && ocr.models.det && ocr.models.rec && ocr.models.cls;
    const engines: string[] = [];
    engines.push(paddleReady ? "PaddleOCR✅" : "PaddleOCR❌");
    engines.push("Tesseract.js✅"); // 纯 JS 兜底，首次跑按需下载语言数据
    engines.push(ocr.ocrSpaceConfigured ? "OCR.space✅" : "OCR.space❌");
    console.log(`  🔤 [OCR] 引擎降级链: ${engines.join(" → ")}`);
    if (!paddleReady) {
      console.log(`     PaddleOCR 未就绪（cli=${ocr.paddleCli}, det=${ocr.models.det}, rec=${ocr.models.rec}, cls=${ocr.models.cls}）；将用 Tesseract.js 本地兜底，无需 API key`);
    }
  } catch (err) {
    console.warn("  ⚠️ [OCR] 状态探测失败:", err instanceof Error ? err.message : err);
  }
});

// 优雅退出处理
let heartbeatEngineRef: { start: () => void; stop: () => void } | null = null;
let agentCronEngineRef: { start: () => void; stop: () => void } | null = null;
let agentMailPollerRef: { stop: () => void } | null = null;
let agentMailWebhookHealthRef: { stop: () => void } | null = null;
const handleShutdown = () => {
  console.log("\n  💾 [Shutdown] 正在关闭服务，清理资源...");
  triggerEngine.stop();
  taskScheduler.stop();
  heartbeatEngineRef?.stop();
  agentCronEngineRef?.stop();
  agentMailPollerRef?.stop();
  agentMailWebhookHealthRef?.stop();
  stopAsyncDeliveryReconciler();
  import("./infra/channels/index.js")
    .then(({ stopAllChannelAdapters }) => stopAllChannelAdapters())
    .catch((err) => {
      console.warn("[Shutdown] stopAllChannelAdapters:", err instanceof Error ? err.message : err);
    });
  import("./infra/freeKeysSync.js")
    .then(({ stopFreeKeysAutoSync }) => stopFreeKeysAutoSync())
    .catch((err) => {
      console.warn("[Shutdown] stopFreeKeysAutoSync:", err instanceof Error ? err.message : err);
    });
  // 串行收尾：先刷盘 SSE 事件、断开 MCP stdio 子进程，再关 HTTP 与 DB
  (async () => {
    try {
      await streamHub.dispose();
    } catch (err) {
      console.warn("[Shutdown] streamHub.dispose:", err instanceof Error ? err.message : err);
    }
    try {
      const { disconnectAllMcpClients } = await import("./infra/mcpClient.js");
      await disconnectAllMcpClients();
    } catch (err) {
      console.warn(
        "[Shutdown] disconnectAllMcpClients:",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      await closeSharedBrowser();
    } catch (err) {
      console.warn("[Shutdown] closeSharedBrowser:", err instanceof Error ? err.message : err);
    }
    server.close(() => {
      prisma
        .$disconnect()
        .then(() => {
          console.log("  👋 [Shutdown] 数据库连接已断开，服务正常退出。");
          process.exit(0);
        })
        .catch((err) => {
          console.warn("[Shutdown] prisma.$disconnect:", err instanceof Error ? err.message : err);
          process.exit(1);
        });
    });
  })().catch((err) => {
    console.warn("[Shutdown] 收尾异常，强制退出:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

export type { AppRouter } from "./router.js";
export type { AsyncQueueStats } from "./infra/asyncJobManager.js";


