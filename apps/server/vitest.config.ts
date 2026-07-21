import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/globalSetup.ts"],
    setupFiles: ["./src/__tests__/setupPrismaIsolation.ts"],
    // SQLite 是文件级单写锁：Vitest 默认并行多 worker 各自建 PrismaClient 连同一个 dev.db，
    // 并发写会争文件锁超过驱动 query_timeout → "Socket timeout"。改为单 fork 串行执行，
    // 所有测试共享一个进程内的 PrismaClient，杜绝跨进程锁竞争（稳定但较慢）。
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // 部分测试涉及 OCR/web_search/同步，给足超时余量
    testTimeout: 30_000,
  },
});
