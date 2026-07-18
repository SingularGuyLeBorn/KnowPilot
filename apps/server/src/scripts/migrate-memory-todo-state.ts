/**
 * 一次性：Memory.status/supersededBy + ChatSession.todoState
 * （避免 prisma db push 误伤 FTS 虚表）
 *
 * 执行：pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-memory-todo-state.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function columnNames(table: string): Promise<Set<string>> {
  const cols = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info(${table})`,
  )) as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

async function main() {
  const memCols = await columnNames("Memory");
  if (!memCols.has("status")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Memory ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    );
    console.log("已添加 Memory.status");
  } else {
    console.log("Memory.status 已存在");
  }
  if (!memCols.has("supersededBy")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE Memory ADD COLUMN supersededBy TEXT`);
    console.log("已添加 Memory.supersededBy");
  } else {
    console.log("Memory.supersededBy 已存在");
  }

  const sessCols = await columnNames("ChatSession");
  if (!sessCols.has("todoState")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ChatSession ADD COLUMN todoState TEXT`);
    console.log("已添加 ChatSession.todoState");
  } else {
    console.log("ChatSession.todoState 已存在");
  }

  // SQLite 索引（幂等）
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS Memory_status_scope_idx ON Memory(status, scope)`,
  );
  console.log("索引 Memory_status_scope_idx 就绪");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
