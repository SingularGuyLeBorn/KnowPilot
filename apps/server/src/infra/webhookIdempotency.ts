/**
 * webhook 幂等 + 死信（DLQ）helper。
 *
 * 幂等：webhook 通道（AgentMail event_id）与兜底轮询通道（poll:message_id）共用一张
 *      ProcessedWebhookEvent 表，消费前 createMany skipDuplicates 抢占，冲突 = 已处理。
 *      替代 askUserGate 的内存 Set（重启不丢）。
 *
 * DLQ：处理失败 / 未匹配 pending 的邮件回复落 DeadLetterMail 表，方便事后追查。
 *      不阻断主流程，仅审计。
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * 抢占事件：消费前调用，成功 = 本进程认领，false = 已被其他通道/进程处理。
 * 用 create + P2002 唯一约束冲突做原子抢占（SQLite 单写者，无并发竞态）。
 */
export async function claimWebhookEvent(
  prisma: PrismaClient,
  eventId: string,
  source: "webhook" | "poll",
  kind: "approval" | "ask_user" | "unmatched",
): Promise<{ claimed: boolean }> {
  if (!eventId) return { claimed: true }; // 无 event_id 不做幂等（下游状态保护兜底）
  try {
    await prisma.processedWebhookEvent.create({
      data: { id: eventId, source, kind },
    });
    return { claimed: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // 唯一约束冲突 = 已存在 = 已处理
      return { claimed: false };
    }
    // 其他错误不阻断（降级为不幂等，下游状态保护兜底）
    console.warn("[webhookIdempotency] claim 异常，降级放行:", err instanceof Error ? err.message : err);
    return { claimed: true };
  }
}

/**
 * 落死信：处理失败 / 未匹配 pending 时调用，仅审计，不阻断。
 */
export async function recordDeadLetterMail(
  prisma: PrismaClient,
  input: {
    messageId?: string;
    threadId?: string;
    inReplyTo?: string;
    subject?: string;
    fromAddr?: string;
    text: string;
    error: string;
    source: "webhook" | "poller";
  },
): Promise<void> {
  try {
    await prisma.deadLetterMail.create({
      data: {
        messageId: input.messageId ?? null,
        threadId: input.threadId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        subject: input.subject ?? null,
        fromAddr: input.fromAddr ?? null,
        text: input.text,
        error: input.error,
        source: input.source,
      },
    });
  } catch (err) {
    // DLQ 落表失败不阻断主流程，仅 warn
    console.warn("[webhookIdempotency] recordDeadLetter 异常:", err instanceof Error ? err.message : err);
  }
}
