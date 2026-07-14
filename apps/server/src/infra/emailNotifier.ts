/**
 * Email Notifier — send_email 通道的唯一发送实现
 *
 * 供两处复用：
 * 1. send_email native 工具（tools/native/integration 域）
 * 2. HeartbeatEngine 心跳连续失败告警（W8 落地，原「Phase 5 实现」僵尸分支）
 *
 * EMAIL_PROVIDER=none（默认）时返回 error，由调用方决定降级策略（工具返回错误 / 心跳记日志）。
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";

export interface EmailSendInput {
  subject: string;
  body: string;
  /** 收件人；缺省读 EMAIL_TO 环境变量 */
  to?: string;
  /** 审计 metadata 用（发起方 Agent id） */
  agentId?: string;
}

export type EmailSendResult = { success: true; message: string } | { error: string };

export async function sendEmailNotification(
  config: AppConfig,
  log: ServiceContainer["log"] | undefined,
  input: EmailSendInput,
): Promise<EmailSendResult> {
  const { subject, body } = input;
  if (!subject || !body) return { error: "send_email 需要 subject 和 body" };

  const provider = config.emailProvider || process.env.EMAIL_PROVIDER || "none";
  if (provider === "none" || !provider) {
    return { error: "邮件未配置（EMAIL_PROVIDER=none），请设置 EMAIL_PROVIDER=smtp 或 agentemail。" };
  }
  const to = input.to || process.env.EMAIL_TO || "";
  if (!to) return { error: "未配置收件人（EMAIL_TO 环境变量或 to 参数）" };

  try {
    if (provider === "smtp") {
      // SMTP 发送（需 nodemailer，动态导入避免未安装时崩溃）
      // @ts-ignore — nodemailer 可选依赖，未安装时 catch 返回 null
      const nodemailer: any = await import("nodemailer").catch(() => null);
      if (!nodemailer?.default?.createTransport && !nodemailer?.createTransport) return { error: "nodemailer 未安装，无法通过 SMTP 发送邮件。" };
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: Number(process.env.EMAIL_SMTP_PORT || "587"),
        secure: process.env.EMAIL_SMTP_SECURE === "true",
        auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS },
      });
      await transporter.sendMail({ from: process.env.EMAIL_SMTP_USER, to, subject, text: body });
    } else if (provider === "agentemail") {
      // AgentEmail API（简单 fetch）
      const apiKey = process.env.AGENTEMAIL_API_KEY;
      if (!apiKey) return { error: "AGENTEMAIL_API_KEY 未配置。" };
      const res = await fetch("https://api.agentemail.com/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ to, subject, body }),
        signal: undefined,
      });
      if (!res.ok) return { error: `AgentEmail 发送失败: HTTP ${res.status}` };
    } else {
      return { error: `未知的邮件提供商: ${provider}` };
    }

    await log?.create?.({
      level: "info", component: "swarm", event: "email_sent",
      message: `邮件已发送: ${subject} → ${to}`,
      metadata: { subject, to, provider, agentId: input.agentId },
    }).catch(() => {});
    return { success: true, message: `邮件已发送到 ${to}` };
  } catch (err) {
    return { error: `邮件发送失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
