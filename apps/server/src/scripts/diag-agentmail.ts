/**
 * 诊断 AgentMail 邮件接收链路：
 * 1. 查 AgentMail inbox 所有邮件（确认邮件是否到 inbox）
 * 2. 查本地 ProcessedWebhookEvent 表（确认 webhook/poller 是否处理过）
 * 3. 查本地 DeadLetterMail 表（确认是否有未匹配落 DLQ）
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

// 手动加载根 .env（dotenv 默认只加载 cwd 的 .env，server 的 .env 在项目根）
const rootEnvPath = path.resolve(process.cwd(), "../../.env");
if (fs.existsSync(rootEnvPath)) {
  for (const raw of fs.readFileSync(rootEnvPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const prisma = new PrismaClient();
const API_BASE = "https://api.agentmail.to/v0";
const apiKey = process.env.AGENTMAIL_API_KEY!;
const inboxId = process.env.AGENTMAIL_INBOX_ID!;

async function main() {
  console.log("=== 1. AgentMail inbox 所有邮件（最近 20 条）===");
  console.log(`inbox: ${inboxId}`);
  try {
    const res = await fetch(`${API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages?limit=20`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.log(`list messages HTTP ${res.status}:`, await res.text().catch(() => ""));
    } else {
      const body = (await res.json()) as {
        messages?: Array<Record<string, unknown>>;
        count?: number;
      };
      const msgs = body.messages ?? [];
      console.log(`共 ${msgs.length} 条`);
      for (const m of msgs) {
        console.log(
          `  - id=${m.message_id ?? m.messageId} thread=${m.thread_id ?? m.threadId} in_reply_to=${m.in_reply_to ?? m.inReplyTo} from=${JSON.stringify(m.from_ ?? m.from)} subject=${m.subject} labels=${JSON.stringify(m.labels)} preview=${String(m.preview ?? m.text ?? "").slice(0, 80)}`,
        );
      }
    }
  } catch (e) {
    console.log("list messages 异常:", (e as Error).message);
  }

  console.log("\n=== 2. 本地 ProcessedWebhookEvent 表（最近 20 条）===");
  const processed = await prisma.processedWebhookEvent.findMany({
    orderBy: { processedAt: "desc" },
    take: 20,
  });
  console.log(`共 ${processed.length} 条`);
  for (const p of processed) {
    console.log(`  - id=${p.id} source=${p.source} kind=${p.kind} at=${p.processedAt.toISOString()}`);
  }

  console.log("\n=== 3. 本地 DeadLetterMail 表（最近 20 条）===");
  const dlq = await prisma.deadLetterMail.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(`共 ${dlq.length} 条`);
  for (const d of dlq) {
    console.log(
      `  - id=${d.id} msg=${d.messageId} thread=${d.threadId} inReplyTo=${d.inReplyTo} subject=${d.subject} source=${d.source} error=${d.error} text=${d.text.slice(0, 80)} at=${d.createdAt.toISOString()}`,
    );
  }

  console.log("\n=== 4. 当前 pending ask_user（内存态，查 DB AskUserRequest）===");
  const pendingAsks = await prisma.askUserRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(`共 ${pendingAsks.length} 条 pending`);
  for (const a of pendingAsks) {
    console.log(
      `  - id=${a.id} session=${a.sessionId} channel=${a.channel} messageId=${a.messageId} threadId=${a.threadId} question=${a.question.slice(0, 60)}`,
    );
  }

  console.log("\n=== 5. 当前 pending 审批 ===");
  const pendingApprovals = await prisma.approval.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, toolName: true, lastNotifiedMessageId: true, lastNotifiedThreadId: true, createdAt: true },
  });
  console.log(`共 ${pendingApprovals.length} 条 pending`);
  for (const a of pendingApprovals) {
    console.log(
      `  - id=${a.id} tool=${a.toolName} msgId=${a.lastNotifiedMessageId} threadId=${a.lastNotifiedThreadId} at=${a.createdAt.toISOString()}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
