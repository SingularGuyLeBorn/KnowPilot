/**
 * CLI：从 GitHub freellm + OpenRouter 同步免费 API Key
 *
 * 用法：
 *   pnpm --filter @knowpilot/server run sync-free-keys
 *   pnpm --filter @knowpilot/server run sync-free-keys:watch
 *
 * 生产路径：server 启动默认挂载 infra/freeKeysSync.startFreeKeysAutoSync
 */

import { PrismaClient } from "@prisma/client";
import { createAppConfig } from "../infra/config.js";
import { syncFreeKeys, startFreeKeysAutoSync, stopFreeKeysAutoSync } from "../infra/freeKeysSync.js";

const prisma = new PrismaClient();
const config = createAppConfig();

async function main() {
  const watch = process.argv.includes("--watch");
  if (watch) {
    startFreeKeysAutoSync(prisma, config);
    return;
  }
  await syncFreeKeys(prisma, config);
  await prisma.$disconnect();
  stopFreeKeysAutoSync();
}

main().catch(async (err) => {
  console.error("❌ [sync-free-keys] 同步失败:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
