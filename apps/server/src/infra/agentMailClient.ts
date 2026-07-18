/**
 * AgentMail（https://www.agentmail.to / api.agentmail.to）
 *
 * 双向邮件：ask_user 发问 + webhook 收回复；也可经 emailNotifier（EMAIL_PROVIDER=agentmail）发通知。
 * 本模块只用 fetch 调 REST，不引入 SDK。
 */

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

export type AgentMailSendResult =
  | { ok: true; messageId: string; threadId?: string; inboxId: string }
  | { ok: false; error: string };

function apiKey(): string | undefined {
  return process.env.AGENTMAIL_API_KEY?.trim() || undefined;
}

function authHeaders(): HeadersInit {
  const key = apiKey();
  if (!key) throw new Error("AGENTMAIL_API_KEY 未配置");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export function isAgentMailConfigured(): boolean {
  return Boolean(apiKey());
}

/** 确保有可用 inbox：优先 AGENTMAIL_INBOX_ID，否则用 client_id=knowpilot 幂等创建 */
export async function ensureAgentMailInbox(): Promise<
  { ok: true; inboxId: string } | { ok: false; error: string }
> {
  if (!apiKey()) return { ok: false, error: "AGENTMAIL_API_KEY 未配置（AgentMail / agentmail.to）" };

  const configured = process.env.AGENTMAIL_INBOX_ID?.trim();
  if (configured) return { ok: true, inboxId: configured };

  try {
    const res = await fetch(`${AGENTMAIL_API_BASE}/inboxes`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        client_id: "knowpilot",
        display_name: "KnowPilot",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      inbox_id?: string;
      inboxId?: string;
      email?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: `AgentMail 创建 inbox 失败: HTTP ${res.status} ${body.error || body.message || ""}`.trim(),
      };
    }
    const inboxId = body.inbox_id || body.inboxId || body.email;
    if (!inboxId) return { ok: false, error: "AgentMail 创建 inbox 成功但未返回 inbox_id" };
    console.info(`[AgentMail] inbox ready: ${inboxId}`);
    return { ok: true, inboxId };
  } catch (err) {
    return { ok: false, error: `AgentMail 创建 inbox 异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sendAgentMailMessage(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<AgentMailSendResult> {
  const inbox = await ensureAgentMailInbox();
  if (!inbox.ok) return { ok: false, error: inbox.error };

  try {
    const res = await fetch(
      `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(inbox.inboxId)}/messages/send`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html || `<pre>${escapeHtml(input.text)}</pre>`,
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      messageId?: string;
      thread_id?: string;
      threadId?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: `AgentMail 发信失败: HTTP ${res.status} ${body.error || body.message || ""}`.trim(),
      };
    }
    const messageId = body.message_id || body.messageId;
    if (!messageId) return { ok: false, error: "AgentMail 发信成功但未返回 message_id" };
    return {
      ok: true,
      messageId,
      threadId: body.thread_id || body.threadId,
      inboxId: inbox.inboxId,
    };
  } catch (err) {
    return { ok: false, error: `AgentMail 发信异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 校验 webhook：支持 header x-agentmail-secret / Authorization Bearer 与 env AGENTMAIL_WEBHOOK_SECRET */
export function verifyAgentMailWebhook(req: {
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // 未配置 secret 时开发期放行并告警；生产应配置
    console.warn("[AgentMail] AGENTMAIL_WEBHOOK_SECRET 未配置，跳过 webhook 验签（仅建议本地开发）");
    return true;
  }
  const h = req.headers;
  const pick = (name: string) => {
    const v = h[name] ?? h[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const provided =
    pick("x-agentmail-secret") ||
    pick("x-webhook-secret") ||
    (pick("authorization")?.startsWith("Bearer ")
      ? pick("authorization")!.slice("Bearer ".length)
      : undefined);
  return provided === secret;
}

export type AgentMailWebhookPayload = {
  event_type?: string;
  event_id?: string;
  message?: {
    message_id?: string;
    thread_id?: string;
    in_reply_to?: string;
    extracted_text?: string;
    text?: string;
    preview?: string;
    subject?: string;
    from_?: string[];
  };
};

export function extractReplyTextFromWebhook(payload: AgentMailWebhookPayload): string {
  const m = payload.message;
  if (!m) return "";
  return (m.extracted_text || m.text || m.preview || "").trim();
}
