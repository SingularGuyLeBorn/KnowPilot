/**
 * 清理 Vitest / E2E smoke 残留在 content/ 与 dev.db 中的实体
 * 用法: pnpm --filter @knowpilot/server cleanup:smoke-artifacts
 */
import { PrismaClient } from "@prisma/client";
import { cleanupSmokeArtifacts } from "../infra/cleanupSmokeArtifacts.js";
import { getAppConfig, loadRootEnv } from "../infra/config.js";

loadRootEnv();
const config = getAppConfig();
const prisma = new PrismaClient();

async function main() {
  const result = await cleanupSmokeArtifacts({ projectRoot: config.projectRoot, prisma });

  console.log(JSON.stringify(result, null, 2));

  if (result.filesRemoved === 0 && result.dbRecordsRemoved === 0) {
    console.log("✅ 无 smoke 残留");
  } else {
    console.log(`\n✅ 已清理 ${result.filesRemoved} 个文件、${result.dbRecordsRemoved} 条数据库记录`);
    console.log("建议随后执行: pnpm db:sync");
  }
}

main()
  .catch((err) => {
    console.error("❌", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
