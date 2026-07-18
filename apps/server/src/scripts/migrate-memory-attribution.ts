/**
 * 一次性：Memory 增加 attribution / validFrom / validTo；清理残破 FTS 表。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-memory-attribution.ts
 */

import { prisma } from "../db.js";

async function main() {
  const cols = (await prisma.$queryRawUnsafe(`PRAGMA table_info('Memory')`)) as Array<{
    name: string;
  }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("attribution")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Memory" ADD COLUMN "attribution" TEXT NOT NULL DEFAULT 'agent'`,
    );
    console.log("added attribution");
  }
  if (!names.has("validFrom")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Memory" ADD COLUMN "validFrom" DATETIME`);
    console.log("added validFrom");
  }
  if (!names.has("validTo")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Memory" ADD COLUMN "validTo" DATETIME`);
    console.log("added validTo");
  }
  for (const t of [
    "search_fts",
    "search_fts_data",
    "search_fts_idx",
    "search_fts_content",
    "search_fts_docsize",
    "search_fts_config",
  ]) {
    try {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
      console.log("dropped", t);
    } catch (e) {
      console.log("skip", t, e instanceof Error ? e.message : e);
    }
  }
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
