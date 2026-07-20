/**
 * 一次性回填：有 contextSummary 的会话 compactGeneration 至少为 1。
 * 合并到目标库执行完即删。
 */

import { prisma } from "../db.js";

async function main() {
  const result = await prisma.chatSession.updateMany({
    where: {
      contextSummary: { not: null },
      compactGeneration: 0,
    },
    data: { compactGeneration: 1 },
  });
  console.log(`[backfill-compact-generation] 回填 ${result.count} 行（有摘要 → generation=1）`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
