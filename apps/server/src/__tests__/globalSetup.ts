/**
 * Vitest 全局 setup/teardown（#2 测试数据隔离）
 *
 * Setup（workers fork 之前，env 会被子进程继承）：
 * 1. DATABASE_URL → file:./test.db（独立测试库，不再污染 dev.db）
 * 2. KP_CONTENT_DIR → .test-content（测试写的 Agent/Post 等 md 文件不落入真实 content/）
 * 3. prisma db push 同步 schema 到 test.db
 *
 * Teardown：清理 smoke 残留 + 关闭共享浏览器。
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "../..");
const projectRoot = path.resolve(serverDir, "../..");
const TEST_DB_URL = "file:./test.db";
const TEST_CONTENT_DIR = path.join(projectRoot, ".test-content");

const CONTENT_SUBDIRS = ["posts", "agents", "skills", "mcp", "memories", "tasks", "prompts", "sources", "uploads", "about"];

export default async function globalSetup() {
  // 1. 隔离数据库：必须在 workers fork（即任何 PrismaClient 实例化）之前设置
  process.env.DATABASE_URL = TEST_DB_URL;
  // 每次全新建库：删除旧 test.db，避免 FTS 虚表残留让 prisma db push 报 DropTable 错
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try {
      fs.rmSync(path.join(serverDir, "prisma", `test.db${suffix}`), { force: true });
    } catch {
      /* ignore */
    }
  }

  // 2. 隔离 content 目录
  fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true });
  for (const sub of CONTENT_SUBDIRS) {
    fs.mkdirSync(path.join(TEST_CONTENT_DIR, sub), { recursive: true });
  }
  process.env.KP_CONTENT_DIR = TEST_CONTENT_DIR;

  // about.getProfile 依赖 about/profile.md：优先复制真实文件，否则写占位
  const realProfile = path.join(projectRoot, "content", "about", "profile.md");
  const testProfile = path.join(TEST_CONTENT_DIR, "about", "profile.md");
  if (fs.existsSync(realProfile)) {
    fs.copyFileSync(realProfile, testProfile);
  } else {
    fs.writeFileSync(testProfile, "---\nname: Test User\n---\n\n# About\n\n测试环境占位 profile。\n");
  }

  // 3. 同步 schema 到 test.db（幂等）
  try {
    execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: "pipe",
    });
  } catch (err) {
    console.error("[globalSetup] prisma db push 到 test.db 失败:", err instanceof Error ? err.message : err);
    throw err;
  }

  // Teardown
  return async () => {
    try {
      // 动态导入：确保 prisma 单例绑定的是 setup 后的 test.db
      const { loadRootEnv, getAppConfig } = await import("../infra/config.js");
      const { cleanupSmokeArtifacts } = await import("../infra/cleanupSmokeArtifacts.js");
      const { prisma } = await import("../db.js");
      loadRootEnv();
      try {
        const config = getAppConfig();
        await cleanupSmokeArtifacts({ projectRoot: config.projectRoot, prisma });
      } catch {
        /* 测试库不可用时忽略 */
      }
      const { closeSharedBrowser } = await import("../infra/metablog/browserPool.js");
      await closeSharedBrowser().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
    } catch {
      /* teardown 尽力而为 */
    }
    // 清理测试 content 目录（保留 test.db 供失败排查）
    try {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
}
