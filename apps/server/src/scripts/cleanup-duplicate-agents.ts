/**
 * 清理因 sync-agents sourceSlug 回写缺失导致的重复 Agent（一次性，可重复执行）
 *
 * 背景：FileSyncService.afterCreate 写 markdown 后未回写 DB sourceSlug，
 * 导致 db:sync 按 sourceSlug 查不到记录，重复创建同名 Agent。
 * 该 bug 已修复，此脚本用于清理历史遗留的重复数据。
 *
 * 策略：按 name 分组，保留每组中最早创建的一个（或 super tier 优先），删除其余。
 * 超级 Agent（tier=super）额外保护：只保留真正的 super，删除 sync 误创建的非 super 同名副本。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany({
    where: { status: { not: "deleted" } },
    select: { id: true, name: true, tier: true, createdAt: true, sourceSlug: true },
    orderBy: { createdAt: "asc" },
  });

  // 按 name 分组
  const byName = new Map<string, typeof agents>();
  for (const a of agents) {
    const arr = byName.get(a.name) ?? [];
    arr.push(a);
    byName.set(a.name, arr);
  }

  const toDelete: string[] = [];
  for (const [name, group] of byName) {
    if (group.length <= 1) continue;

    // 超级 Agent 特殊处理：保留 tier=super 的，删除同名的非 super 副本
    const supers = group.filter((a) => a.tier === "super");
    if (supers.length > 0) {
      // 保留第一个 super，其余全部删除（包括非 super 副本）
      const keep = supers[0];
      for (const a of group) {
        if (a.id !== keep.id) toDelete.push(a.id);
      }
      console.log(`  👑 "${name}"：保留超级 Agent ${keep.id}，删除 ${group.length - 1} 个重复`);
      continue;
    }

    // 普通Agent：保留最早创建的，删除其余
    const keep = group[0];
    for (const a of group) {
      if (a.id !== keep.id) toDelete.push(a.id);
    }
    console.log(`  🗑️ "${name}"：保留 ${keep.id}，删除 ${group.length - 1} 个重复`);
  }

  if (toDelete.length === 0) {
    console.log("✅ 未发现重复 Agent");
    return;
  }

  console.log(`\n即将删除 ${toDelete.length} 个重复 Agent...`);

  // 先删除关联的 ChatSession/ChatMessage（如果有）
  for (const id of toDelete) {
    await prisma.chatMessage.deleteMany({ where: { sessionId: id } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { agentId: id } }).catch(() => {});
    await prisma.agent.delete({ where: { id } }).catch((e) => {
      console.warn(`  ⚠️ 删除 ${id} 失败:`, e instanceof Error ? e.message : e);
    });
  }

  console.log(`\n✅ 共清理 ${toDelete.length} 个重复 Agent`);
}

main()
  .catch((e) => {
    console.error("❌ 清理失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
