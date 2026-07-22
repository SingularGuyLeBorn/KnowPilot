/**
 * 通知通道 — send_email / 心跳告警 / ask_user 提醒
 *
 * 可并行启用多通道（任一成功即算成功）：
 * - EMAIL_PROVIDER=agentmail → AgentMail（agentmail.to）
 * - EMAIL_PROVIDER=smtp → SMTP（QQ 邮箱等）
 * - NTFY_TOPIC 非空 → ntfy.sh（免注册推送，可与上面叠加）
 *
 * 每通道独立 CircuitBreaker：连续失败开闸，冷却后半开探测；开闸期间跳过该通道。
 * EMAIL_PROVIDER=none 且未配 NTFY_TOPIC 时不发。
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { sendAgentMailMessage } from "./agentMailClient.js";
import { CircuitBreaker } from "./circuitBreaker.js";

export interface EmailSendInput {
  subject: string;
  body: string;
  /** 收件人；缺省读 EMAIL_TO（ntfy 不需要） */
  to?: string;
  /** 审计 metadata 用（发起方 Agent id） */
  agentId?: string;
}

export type EmailSendResult =
  | { success: true; message: string; messageId?: string; threadId?: string }
  | { error: string };

/** 通知通道熔断：3 次连续失败开闸，5 分钟冷却 */
const NOTIFY_FAILURE_THRESHOLD = 3;
const NOTIFY_OPEN_DURATION_MS = 5 * 60_000;

const notifyBreakers = new Map<string, CircuitBreaker>();

function getNotifyBreaker(channel: string): CircuitBreaker {
  let b = notifyBreakers.get(channel);
  if (!b) {
    b = new CircuitBreaker({
      failureThreshold: NOTIFY_FAILURE_THRESHOLD,
      openDurationMs: NOTIFY_OPEN_DURATION_MS,
    });
    notifyBreakers.set(channel, b);
  }
  return b;
}

/** 测试用：清空通道熔断器 */
export function __resetNotifyBreakersForTests(): void {
  notifyBreakers.clear();
}

export type NotifyChannelStatus = {
  channel: string;
  state: "closed" | "open" | "half-open";
  failures: number;
};

/** 已触碰过的通知通道熔断状态（供 swarmAlerts 展示） */
export function listNotifyBreakerStatuses(): NotifyChannelStatus[] {
  return [...notifyBreakers.entries()].map(([channel, b]) => ({
    channel,
    state: b.getState(),
    failures: b.getFailureCount(),
  }));
}

async function runWithNotifyBreaker(
  channel: string,
  run: () => Promise<EmailSendResult>,
): Promise<EmailSendResult> {
  const breaker = getNotifyBreaker(channel);
  const permit = breaker.tryAcquire();
  if (!permit.allowed) {
    const secs = Math.ceil(permit.retryAfterMs / 1000);
    return {
      error: `${channel} 通道熔断中（约 ${secs}s 后半开探测），本次跳过`,
    };
  }
  try {
    const result = await run();
    if ("success" in result && result.success) {
      breaker.recordSuccess();
    } else {
      breaker.recordFailure();
    }
    return result;
  } catch (err) {
    breaker.recordFailure();
    return { error: `${channel} 异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendViaSmtp(to: string, subject: string, body: string): Promise<EmailSendResult> {
  // @ts-ignore — nodemailer 可选依赖
  const nodemailer: any = await import("nodemailer").catch(() => null);
  const createTransport = nodemailer?.default?.createTransport || nodemailer?.createTransport;
  if (!createTransport) {
    return { error: "nodemailer 未安装，请在 apps/server 执行 pnpm add nodemailer" };
  }

  const host = process.env.EMAIL_SMTP_HOST || "smtp.qq.com";
  const port = Number(process.env.EMAIL_SMTP_PORT || "465");
  const secure =
    process.env.EMAIL_SMTP_SECURE !== undefined
      ? process.env.EMAIL_SMTP_SECURE === "true"
      : port === 465;
  const user = process.env.EMAIL_SMTP_USER || "";
  const pass = process.env.EMAIL_SMTP_PASS || "";
  if (!user || !pass) {
    return { error: "SMTP 未配置：请设置 EMAIL_SMTP_USER / EMAIL_SMTP_PASS（QQ 邮箱用授权码）" };
  }

  const transporter = createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: process.env.EMAIL_SMTP_FROM || user,
    to,
    subject,
    text: body,
  });
  return { success: true, message: `SMTP 已发送到 ${to}` };
}

async function sendViaAgentMail(to: string, subject: string, body: string): Promise<EmailSendResult> {
  const sent = await sendAgentMailMessage({ to, subject, text: body });
  if (!sent.ok) return { error: sent.error };
  return {
    success: true,
    message: `AgentMail 已发送到 ${to}`,
    messageId: sent.messageId,
    threadId: sent.threadId,
  };
}

/** ntfy.sh：免注册，topic 当密码；见 https://ntfy.sh */
async function sendViaNtfy(subject: string, body: string): Promise<EmailSendResult> {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return { error: "NTFY_TOPIC 未配置" };

  const base = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(topic)}`;
  const headers: Record<string, string> = {
    Title: subject.slice(0, 250),
    Priority: process.env.NTFY_PRIORITY?.trim() || "default",
  };
  const token = process.env.NTFY_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `ntfy 发送失败: HTTP ${res.status} ${text.slice(0, 200)}`.trim() };
  }
  return { success: true, message: `ntfy 已推送到 ${topic}` };
}

export async function sendEmailNotification(
  config: AppConfig,
  log: ServiceContainer["log"] | undefined,
  input: EmailSendInput,
): Promise<EmailSendResult> {
  const { subject, body } = input;
  if (!subject || !body) return { error: "send_email 需要 subject 和 body" };

  const provider = (config.emailProvider || process.env.EMAIL_PROVIDER || "none").toLowerCase();
  const ntfyTopic = process.env.NTFY_TOPIC?.trim();
  const to = input.to || process.env.EMAIL_TO || "";

  const jobs: Array<{ name: string; run: () => Promise<EmailSendResult> }> = [];

  if (provider === "agentmail") {
    if (!to) return { error: "未配置收件人（EMAIL_TO 或 to 参数）" };
    jobs.push({ name: "agentmail", run: () => sendViaAgentMail(to, subject, body) });
  } else if (provider === "smtp") {
    if (!to) return { error: "未配置收件人（EMAIL_TO 或 to 参数）" };
    jobs.push({ name: "smtp", run: () => sendViaSmtp(to, subject, body) });
  } else if (provider === "ntfy") {
    jobs.push({ name: "ntfy", run: () => sendViaNtfy(subject, body) });
  } else if (provider !== "none" && provider) {
    return { error: `未知的 EMAIL_PROVIDER: ${provider}（支持 none / agentmail / smtp / ntfy）` };
  }

  // 与邮件通道叠加：配了 NTFY_TOPIC 且主通道不是纯 ntfy 时也推一把
  if (ntfyTopic && provider !== "ntfy") {
    jobs.push({ name: "ntfy", run: () => sendViaNtfy(subject, body) });
  }

  if (jobs.length === 0) {
    return {
      error:
        "通知未配置：请设置 EMAIL_PROVIDER=agentmail|smtp|ntfy，和/或设置 NTFY_TOPIC（免注册推送）。",
    };
  }

  const results = await Promise.all(
    jobs.map(async (j) => ({
      name: j.name,
      result: await runWithNotifyBreaker(j.name, j.run),
    })),
  );
  const ok = results.filter((r) => "success" in r.result && r.result.success);
  const failed = results.filter((r) => "error" in r.result);

  if (ok.length > 0) {
    const message = ok.map((r) => (r.result as { message: string }).message).join("；");
    const agentMailResult = ok.find((r) => r.name === "agentmail")?.result as
      | { success: true; messageId?: string; threadId?: string }
      | undefined;
    await log
      ?.create?.({
        level: "info",
        component: "swarm",
        event: "email_sent",
        message: `通知已发送: ${subject}（${message}）`,
        metadata: {
          subject,
          to: to || undefined,
          provider,
          channels: ok.map((r) => r.name),
          agentId: input.agentId,
          errors: failed.map((r) => `${r.name}: ${(r.result as { error: string }).error}`),
        },
      })
      .catch(() => {});
    return {
      success: true,
      message,
      messageId: agentMailResult?.messageId,
      threadId: agentMailResult?.threadId,
    };
  }

  return {
    error: failed.map((r) => `${r.name}: ${(r.result as { error: string }).error}`).join("；"),
  };
}
