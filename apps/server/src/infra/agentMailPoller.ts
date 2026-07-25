/**
 * AgentMail 兜底轮询：周期拉 inbox 未读邮件，复用 webhook handler 同款处理逻辑。
 *
 * 作用：webhook 通道挂了（ngrok 断、server 重启中、AgentMail 投递失败）也能收到邮件回复。
 * 幂等：resolveAskUser 有 pending.status 保护、resolveApprovalFromMail 有 DB CAS 保护，
 *      即使 webhook 与轮询并发处理同一封，下游也会拒绝重复注入；处理后立即 mark read 避免再拉。
 *
 * 启动：index.ts 在 AgentMail inbox 就绪后挂载；shutdown 调 stop()。
 */

import type { ServiceContainer } from "./serviceContainer.js";
import type { SessionStreamHub } from "./sessionStreamHub.js";

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

type InboxMessage = {
  message_id?: string;
  messageId?: string;
  thread_id?: string;
  threadId?: string;
  in_reply_to?: string;
  inReplyTo?: string;
  extracted_text?: string;
  text?: string;
  preview?: string;
  subject?: string;
};

type ListMessagesResponse = {
  messages?: InboxMessage[];
  count?: number;
};

function apiKey(): string | undefined {
  return process.env.AGENTMAIL_API_KEY?.trim() || undefined;
}

function authHeaders(): HeadersInit {
  const key = apiKey();
  if (!key) throw new Error("AGENTMAIL_API_KEY 未配置");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function pick(obj: InboxMessage, snake: keyof InboxMessage, camel: keyof InboxMessage): string | undefined {
  return (obj[snake] as string | undefined) ?? (obj[camel] as string | undefined);
}

function extractText(m: InboxMessage): string {
  return (m.extracted_text || m.text || m.preview || "").trim();
}

export function startAgentMailPoller(opts: {
  inboxId: string;
  services: ServiceContainer;
  streamHub: SessionStreamHub;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let inFlight = false;
  let consecutiveErrors = 0;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await pollOnce();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const backoff = Math.min(60_000 * Math.pow(2, consecutiveErrors), 5 * 60_000);
      console.warn(
        `[AgentMail Poller] 第 ${consecutiveErrors} 次失败，下次 ${Math.round(backoff / 1000)}s 后重试:`,
        err instanceof Error ? err.message : err,
      );
      scheduleNext(backoff);
      return;
    } finally {
      inFlight = false;
    }
    scheduleNext(intervalMs);
  }

  function scheduleNext(ms: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void tick();
    }, ms);
  }

  async function pollOnce() {
    const key = apiKey();
    if (!key) return;

    let res: Response;
    try {
      res = await fetch(
        `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(opts.inboxId)}/messages?labels=unread&limit=50`,
        { headers: authHeaders(), signal: AbortSignal.timeout(15000) },
      );
    } catch (err) {
      throw new Error(`list unread 网络异常: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(`list unread HTTP ${res.status} ${body.error || body.message || ""}`.trim());
    }
    const body = (await res.json().catch(() => ({}))) as ListMessagesResponse;
    const messages = body.messages ?? [];
    if (messages.length === 0) return;

    const { resolveApprovalFromMail } = await import("./approvalGate.js");
    const { resolveAskUserFromMail, getAskUserPending } = await import("./askUserGate.js");
    const { claimWebhookEvent, recordDeadLetterMail } = await import("./webhookIdempotency.js");

    for (const m of messages) {
      const messageId = pick(m, "message_id", "messageId");
      const text = extractText(m);
      if (!messageId) continue;

      const inReplyTo = pick(m, "in_reply_to", "inReplyTo");
      const threadId = pick(m, "thread_id", "threadId");
      const subject = pick(m, "subject", "subject");
      // 轮询通道用 poll:message_id 作幂等键，与 webhook 的 event_id 空间不重叠；
      // 跨通道重复靠下游 resolveAskUser 状态保护 / approval DB CAS 兜底
      const pollEventId = `poll:${messageId}`;

      // 幂等抢占：webhook 已处理过同 event_id 则跳过（但 poll:event_id 与 webhook event_id 不同空间，
      // 这里主要防轮询自身重复拉取——mark read 后不会再拉，此为双保险）
      const claim = await claimWebhookEvent(opts.services.prisma, pollEventId, "poll", "unmatched");
      if (!claim.claimed) {
        // 已被前一轮轮询处理过，跳过（理论上 mark read 后不会再拉，此为兜底）
        continue;
      }

      let matched = false;

      // 先按审批回复解析；不匹配再按 ask_user 答复解析（与 webhook handler 顺序一致）
      try {
        const approvalResolved = await resolveApprovalFromMail(opts.services, {
          eventId: pollEventId,
          inReplyTo,
          threadId,
          text,
        });
        if (approvalResolved.ok) {
          matched = true;
          console.info(`[AgentMail Poller] 审批回复已注入: approvalId=${approvalResolved.approvalId}`);
        }
      } catch (err) {
        console.warn("[AgentMail Poller] resolveApprovalFromMail 异常:", err instanceof Error ? err.message : err);
      }

      if (!matched && text) {
        try {
          const resolved = resolveAskUserFromMail({
            eventId: pollEventId,
            inReplyTo,
            threadId,
            text,
          });
          if (resolved.ok) {
            matched = true;
            const pending = getAskUserPending(resolved.askId);
            if (pending?.sessionId) {
              opts.streamHub.pushExternalEvent(pending.sessionId, {
                type: "ask_user_resolved",
                sessionId: pending.sessionId,
                askId: resolved.askId,
                outcome: "answered",
                answer: resolved.answer,
              });
            }
            console.info(`[AgentMail Poller] ask_user 答复已注入: askId=${resolved.askId}`);
          }
        } catch (err) {
          console.warn("[AgentMail Poller] resolveAskUserFromMail 异常:", err instanceof Error ? err.message : err);
        }
      }

      if (!matched) {
        // 未匹配到任何 pending → 落 DLQ 审计
        await recordDeadLetterMail(opts.services.prisma, {
          messageId,
          threadId,
          inReplyTo,
          subject,
          text,
          error: "未匹配 pending 审批/ask_user（可能已过期或普通邮件）",
          source: "poller",
        });
        console.info(`[AgentMail Poller] 未匹配 pending，落 DLQ: subject=${subject ?? ""}`);
      }

      // 处理后 mark read（无论是否匹配，避免下次再拉同一封）
      await markRead(opts.inboxId, messageId);
    }
  }

  async function markRead(inboxId: string, messageId: string) {
    try {
      const res = await fetch(
        `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ add_labels: ["read"], remove_labels: ["unread"] }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        console.warn(`[AgentMail Poller] mark read 失败 HTTP ${res.status}: ${b.error ?? ""}`);
      }
    } catch (err) {
      console.warn("[AgentMail Poller] mark read 异常:", err instanceof Error ? err.message : err);
    }
  }

  // 启动：首次延迟 30s（给 webhook 通道优先机会，避免启动风暴）
  scheduleNext(30_000);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
