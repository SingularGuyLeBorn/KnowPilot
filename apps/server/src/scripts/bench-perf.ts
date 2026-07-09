/**
 * 性能基准脚本（#17）—— 对优化前后的关键热路径做一次手动计时，输出数字供审计报告记录。
 * 用 tsx 运行：pnpm --filter @knowpilot/server exec tsx src/scripts/bench-perf.ts
 */
import { PrismaClient } from "@prisma/client";
import { searchFts } from "../infra/ftsIndex.js";
import { getAnalyticsDashboard } from "../infra/analytics.js";

const prisma = new PrismaClient();

async function timeit<T>(label: string, fn: () => Promise<T>, runs = 5): Promise<void> {
  // 预热
  await fn().catch(() => undefined);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await fn().catch(() => undefined);
    times.push(Date.now() - t);
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`${label.padEnd(48)} avg=${avg}ms min=${min}ms max=${max}ms`);
}

async function main() {
  console.log("\n=== KnowPilot 性能基准（dev.db）===\n");

  // 文章数/会话数上下文
  const postCount = await prisma.post.count();
  const sessionCount = await prisma.chatSession.count();
  const agentCount = await prisma.agent.count();
  const runCount = await prisma.run.count();
  console.log(`上下文: posts=${postCount} sessions=${sessionCount} agents=${agentCount} runs=${runCount}\n`);

  // 搜索：FTS（R1）vs LIKE 全表扫
  const query = "KnowPilot";
  await timeit("post.search FTS (searchFts post)", () => searchFts(prisma, query, 10));
  await timeit("post.search LIKE (title+content contains)", () =>
    prisma.post.findMany({ where: { deletedAt: null, OR: [{ title: { contains: query } }, { content: { contains: query } }] }, take: 10 }),
  );

  // session.getById 含 500 条消息（P0-1 载荷来源）
  const firstSession = await prisma.chatSession.findFirst({ select: { id: true }, orderBy: { updatedAt: "desc" } });
  if (firstSession) {
    await timeit("session.getById (include messages take 500)", () =>
      prisma.chatSession.findUnique({ where: { id: firstSession.id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 500 } } }),
    );
    // 载荷大小
    const full = await prisma.chatSession.findUnique({ where: { id: firstSession.id }, include: { messages: { take: 500 } } });
    const payloadBytes = Buffer.byteLength(JSON.stringify(full), "utf-8");
    console.log(`  -> 单会话载荷 ~${(payloadBytes / 1024).toFixed(1)} KiB (${full?.messages?.length ?? 0} 条消息)`);
  }

  // agent.list
  await timeit("agent.list (take 100, 全字段)", () => prisma.agent.findMany({ take: 100 }));

  // dashboard 13 count（首次冷调用，R8 缓存未命中）
  await timeit("analytics.dashboard (13 count, 冷)", () => getAnalyticsDashboard(prisma), 3);

  // swarmStats SQL groupBy（#9）
  await timeit("swarmStats groupBy (30d)", async () => {
    const since = new Date(Date.now() - 30 * 86400000);
    await prisma.run.groupBy({ by: ["agentId", "status"], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { durationMs: true, toolCallCount: true } });
  }, 3);

  console.log("\n=== 基准结束 ===\n");
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
