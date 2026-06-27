/**
 * KnowPilot Server — Express + tRPC 入口
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || "3010", 10);

// CORS
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  })
);

// JSON body 解析
app.use(express.json({ limit: "10mb" }));

// 健康检查 (非 tRPC)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// tRPC 挂载
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path }) {
      console.error(`[tRPC Error] ${path}:`, error.message);
    },
  })
);

// 启动
app.listen(PORT, () => {
  console.log(`\n  🚀 KnowPilot Server running at http://localhost:${PORT}`);
  console.log(`  📡 tRPC endpoint: http://localhost:${PORT}/api/trpc`);
  console.log(`  💚 Health check:  http://localhost:${PORT}/health\n`);
});

export type { AppRouter } from "./trpc/router.js";


