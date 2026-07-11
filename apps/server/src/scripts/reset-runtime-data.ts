/**
 * 清空运行时对话数据并保留 Swarm 骨架（超级/管理 Agent + Workspace）。
 * 用法: pnpm --filter @knowpilot/server run reset:runtime
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

function safeRm(filePath: string) {
  try {
    fs.rmSync(filePath, { force: true, recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const before = {
    sessions: await prisma.chatSession.count(),
    messages: await prisma.chatMessage.count(),
    agentMessages: await prisma.agentMessage.count(),
    streamEvents: await prisma.sessionStreamEvent.count(),
    subAgents: await prisma.agent.count({ where: { tier: "sub" } }),
  };

  await prisma.sessionQueueItem.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.sessionStreamEvent.deleteMany({});
  await prisma.agentMessage.deleteMany({});
  await prisma.task.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "[async]" } },
        { name: { startsWith: "[async-share]" } },
        { name: { startsWith: "[heartbeat]" } },
        { type: "async_agent" },
      ],
    },
  });
  await prisma.chatSession.deleteMany({});

  const subs = await prisma.agent.findMany({
    where: { tier: "sub" },
    select: { id: true, name: true, sourceSlug: true },
  });
  for (const a of subs) {
    await prisma.agent.delete({ where: { id: a.id } }).catch(() => undefined);
  }

  const contentRoot = path.resolve(process.cwd(), "../../content");
  const sessionsDir = path.join(contentRoot, "sessions");
  const agentsDir = path.join(contentRoot, "agents");
  let removedFiles = 0;

  if (fs.existsSync(sessionsDir)) {
    for (const name of fs.readdirSync(sessionsDir)) {
      if (name === ".gitkeep") continue;
      if (safeRm(path.join(sessionsDir, name))) removedFiles++;
    }
  }

  if (fs.existsSync(agentsDir)) {
    for (const name of fs.readdirSync(agentsDir)) {
      if (name === ".gitkeep") continue;
      if (/超级/.test(name) || /管理\s*Agent/.test(name)) continue;
      if (/子\s*Agent/i.test(name) || /smoke/i.test(name) || /subagent/i.test(name)) {
        if (safeRm(path.join(agentsDir, name))) removedFiles++;
      }
    }
  }

  const after = {
    sessions: await prisma.chatSession.count(),
    messages: await prisma.chatMessage.count(),
    agentMessages: await prisma.agentMessage.count(),
    streamEvents: await prisma.sessionStreamEvent.count(),
    subAgents: await prisma.agent.count({ where: { tier: "sub" } }),
    kept: await prisma.agent.count({ where: { tier: { in: ["super", "manager"] } } }),
  };

  console.log("🗑️ 运行时数据已重置");
  console.log(`   ChatSession: ${before.sessions} → ${after.sessions}`);
  console.log(`   ChatMessage: ${before.messages} → ${after.messages}`);
  console.log(`   AgentMessage: ${before.agentMessages} → ${after.agentMessages}`);
  console.log(`   StreamEvent: ${before.streamEvents} → ${after.streamEvents}`);
  console.log(`   子 Agent: ${before.subAgents} → ${after.subAgents}`);
  console.log(`   保留 super/manager: ${after.kept}`);
  console.log(`   清理 content 文件: ${removedFiles}`);
  console.log("👉 重启 server 后 swarmInitializer 会确保超级 Agent / 系统 Workspace 就绪。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
