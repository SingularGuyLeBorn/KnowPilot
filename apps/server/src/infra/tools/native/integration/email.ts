/**
 * 集成域 — send_email（从 integration.ts 拆出，P2-01 选 B）
 *
 * 发送邮件通知用户（任务完成、预算耗尽、心跳失败等）。需配置 EMAIL_PROVIDER 环境变量。
 * 发送通道单点实现见 infra/emailNotifier.ts（HeartbeatEngine 失败告警复用同一通道）。
 */
import { sendEmailNotification } from "../../../emailNotifier.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { z } from "zod";
import { zodParams } from "../zodParams.js";

async function sendEmailTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const rawSubject = String(args.subject || "");
  const subject = rawSubject.startsWith("[KnowPilot 通知]") ? rawSubject : `[KnowPilot 通知] ${rawSubject}`;
  return sendEmailNotification(ctx.config, ctx.services.log, {
    subject,
    body: String(args.body || ""),
    to: (args.to as string) || undefined,
    agentId: ctx.agentSnapshot?.id,
  });
}

export const emailDefs: NativeToolDefinition[] = [
  {
    name: "send_email",
    description: "发送邮件通知用户（任务完成、预算耗尽、心跳失败等）。需配置 EMAIL_PROVIDER 环境变量。",
    parameters: zodParams(
      z.object({
        subject: z.string().describe("邮件主题"),
        body: z.string().describe("邮件正文（纯文本）"),
        to: z.string().describe("收件人邮箱（不填则用 EMAIL_TO 环境变量）").optional(),
      }),
    ),
  },
];

export const emailHandlers: Record<string, NativeToolHandler> = {
  send_email: sendEmailTool,
};
