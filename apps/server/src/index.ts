/**
 * KnowPilot Server — Express + tRPC 入口
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router.js";
import { createContext } from "./trpc/context.js";

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || "3010", 10);

// 定位 content 目录 (与 sync.ts / post.ts 保持一致)
let postsDir = path.resolve(process.cwd(), "content/posts");
if (!fs.existsSync(postsDir)) {
  postsDir = path.resolve(process.cwd(), "../../content/posts");
}

const uploadsDir = path.resolve(process.cwd(), "content/uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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

// 文章本地资源（图片等）静态服务
if (fs.existsSync(postsDir)) {
  app.use("/api/posts/assets", express.static(postsDir));
}

// 上传文件静态服务
app.use("/uploads", express.static(uploadsDir));

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


