/**
 * 一次性：ChatSession 增加 pinnedMemorySnapshot 列。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-pinned-memory-snapshot.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("ChatSession")`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("pinnedMemorySnapshot")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ChatSession" ADD COLUMN "pinnedMemorySnapshot" TEXT`,
    );
    console.log("added pinnedMemorySnapshot");
  } else {
    console.log("pinnedMemorySnapshot already exists");
  }
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
