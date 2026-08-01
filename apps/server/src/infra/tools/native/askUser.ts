/**
 * Native ask_user —— Agent 向用户提问并挂起 run，直到 UI / 邮件答复。
 *
 * channel=ui（默认）：Chat 弹框选项；channel=email：AgentMail（agentmail.to）发信。
 * 提醒邮件走 emailNotifier（EMAIL_PROVIDER=agentmail / smtp）。
 */

import { z } from "zod";
import { zodParams } from "./zodParams.js";
import {
  type NativeToolContext,
  type NativeToolDefinition,
  type NativeToolHandler,
} from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import {
  bindAskUserMailIds,
  createAskUserPending,
  type AskUserChannel,
} from "../../askUserGate.js";
import { isAgentMailConfigured, sendAgentMailMessage } from "../../agentMailClient.js";
import { getStreamHub } from "../../sessionStreamHub.js";

const askUserParameters = zodParams(
  z.object({
    question: z.string().min(1, "问题不能为空"),
    options: z.array(z.string().min(1)).max(8).optional(),
    channel: z.enum(["ui", "email"]).optional(),
    subject: z.string().max(200).optional(),
    to: z
      .string()
      .describe("收件人邮箱（仅 channel=email 时生效；不填则用 AGENTMAIL_ASK_TO / EMAIL_TO 环境变量）")
      .optional(),
  }),
);

function normalizeOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw.map((o) => String(o).trim()).filter(Boolean).slice(0, 8);
  return options.length > 0 ? options : undefined;
}

async function askUserTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId) {
    return { success: false, error: "ask_user 需要在 Chat 会话中调用（缺少 sessionId）" };
  }

  const question = String(args.question || "").trim();
  if (!question) return { success: false, error: "question 不能为空" };

  const channel = (String(args.channel || "ui").toLowerCase() === "email" ? "email" : "ui") as AskUserChannel;
  const options = normalizeOptions(args.options);
  const subject = String(args.subject || "[OasisMind 需回复] 需要你的确认").trim();

  let messageId: string | undefined;
  let threadId: string | undefined;
  let emailSentTo: string | undefined;

  if (channel === "email") {
    if (!isAgentMailConfigured()) {
      return {
        success: false,
        error: "ask_user channel=email 需要配置 AGENTMAIL_API_KEY（AgentMail / agentmail.to）。",
      };
    }
    const to =
      String(args.to || "").trim() ||
      process.env.AGENTMAIL_ASK_TO?.trim() ||
      process.env.EMAIL_TO?.trim() ||
      "";
    if (!to) {
      return { success: false, error: "未配置问人收件人（to 参数或 EMAIL_TO / AGENTMAIL_ASK_TO 环境变量）" };
    }

    const optionsBlock =
      options && options.length > 0
        ? `\n\n请回复选项编号或完整选项文案：\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
        : "\n\n请直接回复本邮件作答。";

    const text =
      `${question}${optionsBlock}\n\n` +
      `——\n此邮件由 OasisMind Agent 发出。请直接「回复」本邮件；也可在 Chat 弹框中作答。\n` +
      `会话：${ctx.sessionId}\n`;

    const sent = await sendAgentMailMessage({ to, subject, text });
    if (!sent.ok) return { success: false, error: sent.error };
    messageId = sent.messageId;
    threadId = sent.threadId;
    emailSentTo = to;
  }

  const pending = await createAskUserPending({
    sessionId: ctx.sessionId,
    question,
    options,
    channel,
    subject,
    agentId: ctx.agentSnapshot?.id,
    messageId,
    threadId,
    config: ctx.config,
    log: ctx.services.log,
  });

  if (messageId || threadId) {
    bindAskUserMailIds(pending.askId, { messageId, threadId });
  }

  const hub = getStreamHub();
  hub?.pushExternalEvent(ctx.sessionId, {
    type: "ask_user_pending",
    sessionId: ctx.sessionId,
    askId: pending.askId,
    question,
    options,
    channel,
    subject,
  });

  return {
    success: true,
    status: "waiting_for_user",
    message:
      channel === "email"
        ? `已向 ${emailSentTo} 发送提问邮件，等待用户回复或 Chat 作答。`
        : "已在 Chat 弹出提问，等待用户选择或输入。",
    askId: pending.askId,
    question,
    options,
    channel,
    subject,
    askUserPending: {
      askId: pending.askId,
      question,
      options,
      channel,
      subject,
    },
  };
}

const defs: NativeToolDefinition[] = [
  {
    name: "ask_user",
    description:
      "【向用户提问并挂起 run，等待用户答复】调用后 run 暂停，直到用户作答（Chat 弹框或回复邮件）或超时。" +
      "必用场景：(1) 需要用户回答开放问题；(2) 需要用户在选项中选一个；(3) 需要用户确认/决策某事。" +
      "channel=ui（默认）：Chat 弹框显示选项 + 自定义输入框，用户在网页作答。" +
      "channel=email：经 AgentMail 发一封【可回复】邮件，用户不在电脑前可直接回复邮件，" +
      "回复内容会回填到 Chat 的 customResponse 输入框并注入会话继续本轮（不产生独立 user 气泡）。" +
      "to 参数（channel=email 时）：指定收件人邮箱，不填则用 AGENTMAIL_ASK_TO / EMAIL_TO 环境变量。" +
      "options：给 2~8 个候选选项；不给则视为开放问题（用户自定义输入）。" +
      "⚠️ 单向通知（不需等回复，如任务完成/告警）用 send_email，**禁止**用本工具发通知。" +
      "⚠️ 不要对同一问题重复调用本工具；用户答复后基于答复继续，除非用户要求澄清。",
    parameters: askUserParameters,
    concurrencyClass: "B",
  },
];

const handlers: Record<string, NativeToolHandler> = {
  ask_user: askUserTool,
};

export function registerAskUserTools(): void {
  registerNativeDomain(defs, handlers);
}
