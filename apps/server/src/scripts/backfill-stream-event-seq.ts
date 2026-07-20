/**
 * 一次性回填：SessionStreamEvent.seq = id（存量行与全局 id 对齐，保证 per-session 单调）。
 * 合并到目标库执行完即删本脚本。
 *
 * 用法：DATABASE_URL=file:./dev.db pnpm --filter @knowpilot/server exec tsx src/scripts/backfill-stream-event-seq.ts
 */

import { prisma } from "../db.js";

async function main() {
  const rows = await prisma.sessionStreamEvent.findMany({
    where: { seq: 0 },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let updated = 0;
  for (const row of rows) {
    await prisma.sessionStreamEvent.update({
      where: { id: row.id },
      data: { seq: row.id },
    });
    updated += 1;
  }
  console.log(`[backfill-stream-event-seq] 回填 ${updated} 行（seq=id）`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
