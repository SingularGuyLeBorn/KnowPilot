import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// apps/web 最小单测基建（W16b）：jsdom + createRoot + act，不引入 RTL。
// 与 server/shared 同款 vitest（3.2.3），根 `pnpm test` 经 pnpm -r 一并跑到。
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["components/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
  },
});
