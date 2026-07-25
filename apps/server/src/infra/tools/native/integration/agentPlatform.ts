/**
 * 集成域 — 外部 Agent 平台接入（Coze + Dify）
 *
 * 让 KnowPilot Agent 能把子任务委托给外部 agent 平台（Coze 扣子 / Dify），
 * 复用平台上已编排好的 bot / workflow（RAG、知识库、复杂多步逻辑）。
 * 纯 HTTP 调用，本地零额外依赖。Credential 走 credentialVault（scope=coze/dify）。
 */
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { getCredentialValue } from "../../../credentialVault.js";

function readEnv(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function cozeHost(): string {
  return readEnv("COZE_API_HOST", "https://api.coze.cn");
}

function difyBase(): string {
  return readEnv("DIFY_API_BASE", "https://api.dify.ai/v1");
}

async function requireToken(ctx: NativeToolContext, scope: string, name: string, envName: string): Promise<string> {
  const fromDb = ctx.prisma ? await getCredentialValue(ctx.prisma, scope, name) : undefined;
  const token = (fromDb && fromDb.trim()) || readEnv(envName);
  if (!token) {
    throw new Error(`未配置 ${scope} 凭据：请在 Credential 表新增 scope=${scope} name=${name}，或设置环境变量 ${envName}。`);
  }
  return token;
}

/** Coze v3 chat：异步发起 → 轮询 message/list → 取 assistant answer */
async function cozeChat(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const botId = String(args.bot_id ?? "").trim();
  if (!botId) throw new Error("需要 bot_id 参数（Coze bot ID）");
  const message = String(args.message ?? "").trim();
  if (!message) throw new Error("需要 message 参数（用户消息）");
  const userId = String(args.user_id ?? "knowpilot-agent").trim();
  const conversationId = args.conversation_id ? String(args.conversation_id) : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? Math.min(args.timeoutMs, 120000) : 60000;
  const token = await requireToken(ctx, "coze", "access_token", "COZE_ACCESS_TOKEN");
  const host = cozeHost();
  const started = Date.now();

  const createRes = await fetch(`${host}/v3/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      bot_id: botId,
      user_id: userId,
      stream: false,
      auto_save_history: true,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      additional_messages: [{ role: "user", content_type: "text", content: message }],
    }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`Coze /v3/chat 发起失败 ${createRes.status}: ${errText.slice(0, 500)}`);
  }
  const createJson = await createRes.json() as { code?: number; msg?: string; data?: { id?: string; conversation_id?: string } };
  if (createJson.code !== 0) {
    throw new Error(`Coze /v3/chat 业务失败: ${createJson.msg || JSON.stringify(createJson).slice(0, 500)}`);
  }
  const chatId = createJson.data?.id;
  const convId = createJson.data?.conversation_id;
  if (!chatId || !convId) throw new Error("Coze /v3/chat 未返回 chat_id/conversation_id");

  // 轮询 message/list 直到 status=completed
  const deadline = started + timeoutMs;
  let messages: Array<{ role?: string; type?: string; content?: string; content_type?: string }> = [];
  for (;;) {
    if (Date.now() > deadline) {
      return { ok: false, chatId, conversationId: convId, note: `轮询超时（${timeoutMs}ms），可稍后用 chat_id 查询。`, elapsedMs: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, 1500));
    const listRes = await fetch(`${host}/v3/chat/message/list?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(convId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) continue;
    const listJson = await listRes.json() as { code?: number; data?: { messages?: typeof messages; status?: string } };
    if (listJson.code !== 0) continue;
    messages = listJson.data?.messages || [];
    if (listJson.data?.status === "completed") break;
  }

  const answer = messages.find((m) => m.role === "assistant" && m.type === "answer")?.content || "";
  const followUps = messages.filter((m) => m.role === "assistant" && m.type === "follow_up").map((m) => m.content).filter(Boolean);
  return {
    ok: true,
    answer,
    followUpQuestions: followUps,
    chatId,
    conversationId: convId,
    elapsedMs: Date.now() - started,
  };
}

/** Coze workflow：执行已发布的工作流，blocking 模式 */
async function cozeWorkflow(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const workflowId = String(args.workflow_id ?? "").trim();
  if (!workflowId) throw new Error("需要 workflow_id 参数");
  const parameters = (args.parameters && typeof args.parameters === "object" ? args.parameters : {}) as Record<string, unknown>;
  const botId = args.bot_id ? String(args.bot_id) : undefined;
  const token = await requireToken(ctx, "coze", "access_token", "COZE_ACCESS_TOKEN");
  const host = cozeHost();
  const started = Date.now();

  const res = await fetch(`${host}/v1/workflow/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow_id: workflowId,
      parameters,
      ...(botId ? { bot_id: botId } : {}),
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Coze /v1/workflow/run 失败 ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json() as { code?: number; msg?: string; data?: unknown; debug_url?: string };
  if (json.code !== 0) {
    throw new Error(`Coze workflow 业务失败: ${json.msg || JSON.stringify(json).slice(0, 500)}`);
  }
  return { ok: true, data: json.data, debugUrl: json.debug_url, elapsedMs: Date.now() - started };
}

/** Dify chat-messages：blocking 模式，直接返回 answer */
async function difyChat(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("需要 query 参数（用户消息）");
  const user = String(args.user ?? "knowpilot-agent").trim();
  const inputs = (args.inputs && typeof args.inputs === "object" ? args.inputs : {}) as Record<string, unknown>;
  const conversationId = args.conversation_id ? String(args.conversation_id) : undefined;
  const apiKey = await requireToken(ctx, "dify", "api_key", "DIFY_API_KEY");
  const base = difyBase();
  const started = Date.now();

  const res = await fetch(`${base}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs,
      query,
      user,
      response_mode: "blocking",
      auto_save_history: true,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Dify /chat-messages 失败 ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json() as { answer?: string; conversation_id?: string; message_id?: string };
  return {
    ok: true,
    answer: json.answer || "",
    conversationId: json.conversation_id,
    messageId: json.message_id,
    elapsedMs: Date.now() - started,
  };
}

/** Dify workflow run：blocking 模式，返回 outputs */
async function difyWorkflow(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const inputs = (args.inputs && typeof args.inputs === "object" ? args.inputs : {}) as Record<string, unknown>;
  const user = String(args.user ?? "knowpilot-agent").trim();
  const apiKey = await requireToken(ctx, "dify", "api_key", "DIFY_API_KEY");
  const base = difyBase();
  const started = Date.now();

  const res = await fetch(`${base}/workflows/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs, user, response_mode: "blocking" }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Dify /workflows/run 失败 ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json() as { task_id?: string; workflow_run_id?: string; data?: { outputs?: unknown; status?: string; error?: string } };
  if (json.data?.status && json.data.status !== "succeeded") {
    throw new Error(`Dify workflow 未成功: ${json.data.status} ${json.data.error || ""}`);
  }
  return {
    ok: true,
    outputs: json.data?.outputs,
    taskId: json.task_id,
    workflowRunId: json.workflow_run_id,
    elapsedMs: Date.now() - started,
  };
}

export const agentPlatformDefs: NativeToolDefinition[] = [
  {
    name: "coze_chat",
    concurrencyClass: "B",
    description:
      "调用 Coze（扣子）平台上已发布的 Bot 进行对话。用于把子任务委托给外部 Coze agent（常带 RAG/知识库/插件）。需先在 Coze 平台把 Bot 发布为 API 服务并拿到 access_token。返回 answer（Bot 回答）+ followUpQuestions（追问建议）+ conversationId（可续接多轮）。凭据：Credential 表 scope=coze name=access_token，或环境变量 COZE_ACCESS_TOKEN；Coze 区域用 COZE_API_HOST（默认 https://api.coze.cn 国内，国际站设 https://api.coze.com）。",
    parameters: {
      type: "object",
      properties: {
        bot_id: { type: "string", description: "Coze Bot ID（平台 Bot 开发页 URL 中 bot 参数后的数字）" },
        message: { type: "string", description: "发给 Bot 的用户消息" },
        user_id: { type: "string", description: "终端用户标识，默认 knowpilot-agent" },
        conversation_id: { type: "string", description: "可选，续接已有会话时传入" },
        timeoutMs: { type: "number", description: "轮询超时毫秒，默认 60000，上限 120000" },
      },
      required: ["bot_id", "message"],
    },
  },
  {
    name: "coze_workflow",
    concurrencyClass: "B",
    description:
      "执行 Coze（扣子）平台上已发布的工作流（Workflow）。用于复用 Coze 编排的复杂多步逻辑（含数据库节点、变量节点等）。blocking 模式直接返回 data。凭据同 coze_chat（scope=coze name=access_token 或 COZE_ACCESS_TOKEN）。",
    parameters: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Coze Workflow ID" },
        parameters: { type: "object", description: "工作流输入参数对象" },
        bot_id: { type: "string", description: "可选，关联的 Bot ID" },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "dify_chat",
    concurrencyClass: "B",
    description:
      "调用 Dify 平台上已发布的 Chatflow/Agent/Chatbot 应用进行对话。用于把子任务委托给外部 Dify agent（常带 RAG/工具/记忆）。blocking 模式直接返回 answer。返回 answer + conversationId + messageId。凭据：Credential 表 scope=dify name=api_key，或环境变量 DIFY_API_KEY；自托管 Dify 用 DIFY_API_BASE（默认 https://api.dify.ai/v1，自托管设为 https://你的域名/v1）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "用户消息" },
        user: { type: "string", description: "终端用户标识，默认 knowpilot-agent" },
        inputs: { type: "object", description: "可选，应用的输入变量对象" },
        conversation_id: { type: "string", description: "可选，续接已有会话时传入" },
      },
      required: ["query"],
    },
  },
  {
    name: "dify_workflow",
    concurrencyClass: "B",
    description:
      "执行 Dify 平台上已发布的 Workflow 应用。用于复用 Dify 编排的复杂工作流。blocking 模式直接返回 outputs。凭据同 dify_chat（scope=dify name=api_key 或 DIFY_API_KEY）。",
    parameters: {
      type: "object",
      properties: {
        inputs: { type: "object", description: "工作流输入变量对象" },
        user: { type: "string", description: "终端用户标识，默认 knowpilot-agent" },
      },
      required: ["inputs"],
    },
  },
];

export const agentPlatformHandlers: Record<string, NativeToolHandler> = {
  coze_chat: cozeChat,
  coze_workflow: cozeWorkflow,
  dify_chat: difyChat,
  dify_workflow: difyWorkflow,
};

