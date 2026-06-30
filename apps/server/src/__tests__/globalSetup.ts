import { loadRootEnv, getAppConfig } from "../infra/config.js";
import { cleanupSmokeArtifacts } from "../infra/cleanupSmokeArtifacts.js";
import { closeSharedBrowser } from "../infra/metablog/browserPool.js";
import { prisma } from "../db.js";

/** Vitest 全局 teardown：清理 smoke 残留并关闭共享 Playwright 浏览器 */
export default async function globalSetup() {
  loadRootEnv();
  return async () => {
    try {
      const config = getAppConfig();
      await cleanupSmokeArtifacts({ projectRoot: config.projectRoot, prisma });
    } catch {
      /* 测试库不可用时忽略 */
    }
    await closeSharedBrowser().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };
}
