/**
 * 一次性：为 Workspace 表增加 asyncSlotQuota 列（避免 prisma db push 误伤 FTS 虚表）。
 * 执行：pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-workspace-async-slot-quota.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cols = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "PRAGMA table_info(Workspace)",
  )) as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("asyncSlotQuota")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE Workspace ADD COLUMN asyncSlotQuota INTEGER NOT NULL DEFAULT 2",
    );
    console.log("已添加 Workspace.asyncSlotQuota（默认 2）");
  } else {
    console.log("Workspace.asyncSlotQuota 已存在，跳过 ADD COLUMN");
  }
  const updated = await prisma.$executeRawUnsafe(
    "UPDATE Workspace SET asyncSlotQuota = 0 WHERE isSystem = 1",
  );
  console.log(`Root/系统 Workspace 配额已设为 0（不限），affected=${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
