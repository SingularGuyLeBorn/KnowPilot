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
    description:
      "【单向通知邮件，不等待回复】发完即止，run 不挂起，用户回复不会被回收进会话。" +
      "用途：任务完成/预算耗尽/心跳失败/进度汇报等只需告知用户、不需要用户回答的场景。" +
      "to 参数：指定收件人邮箱，不填则用 EMAIL_TO 环境变量。" +
      "⚠️ 如果你需要用户回答问题、做决策、确认某事，**禁止**用本工具，必须改用 ask_user(channel=email)——" +
      "它会发一封可回复邮件并挂起 run 等待用户答复（Chat 作答或回复邮件均可），答复会回填 customResponse 并注入会话继续。",
    parameters: zodParams(
      z.object({
        subject: z.string().describe("邮件主题（自动加 [KnowPilot 通知] 前缀）"),
        body: z.string().describe("邮件正文（纯文本）"),
        to: z.string().describe("收件人邮箱（不填则用 EMAIL_TO 环境变量）").optional(),
      }),
    ),
  },
];

export const emailHandlers: Record<string, NativeToolHandler> = {
  send_email: sendEmailTool,
};
