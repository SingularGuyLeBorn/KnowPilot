/**
 * 一次性：为 McpServer 增加 transport / url / headers 列（SQLite ALTER）。
 * 执行：pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-mcp-transport.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tryAlter(sql: string, label: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  + ${label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate column|already exists/i.test(msg)) {
      console.log(`  skip ${label}`);
      return;
    }
    // SQLite: "duplicate column name: transport"
    if (msg.includes("duplicate column name")) {
      console.log(`  skip ${label}`);
      return;
    }
    console.log(`  ? ${label}: ${msg.slice(0, 120)}`);
  }
}

async function main() {
  console.log("McpServer transport migration");
  await tryAlter(
    `ALTER TABLE McpServer ADD COLUMN transport TEXT NOT NULL DEFAULT 'stdio'`,
    "transport",
  );
  await tryAlter(`ALTER TABLE McpServer ADD COLUMN url TEXT`, "url");
  await tryAlter(`ALTER TABLE McpServer ADD COLUMN headers TEXT`, "headers");
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
