#!/usr/bin/env node
/**
 * SQLite 数据库备份 — L5-M04
 *
 * 将数据库复制到 backups/ 目录，文件名含时间戳。
 *
 * WAL 模式下最近事务可能仍在 dev.db-wal 中，裸拷主库文件会静默丢数据。
 * 因此先通过 Prisma（server 现有 SQLite 驱动，不新增依赖）执行
 * `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 合并回主库文件，再拷贝主库文件。
 * 库路径从 DATABASE_URL（file: 前缀）解析；相对路径相对 schema 目录（与 Prisma 行为一致）。
 *
 * 用法：pnpm db:backup
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const serverDir = path.join(projectRoot, "apps/server");
const schemaDir = path.join(serverDir, "prisma");
const backupDir = path.join(projectRoot, "backups");

// 复用 apps/server 的依赖上下文（dotenv + @prisma/client），不新增重依赖
const serverRequire = createRequire(path.join(serverDir, "package.json"));
const dotenv = serverRequire("dotenv");
dotenv.config({ path: path.join(projectRoot, ".env") });

let PrismaClient;
try {
  ({ PrismaClient } = serverRequire("@prisma/client"));
} catch {
  console.error("❌ 无法加载 @prisma/client，请先运行 pnpm db:generate 生成 Prisma Client。");
  process.exit(1);
}

/** 解析 DATABASE_URL=file:... 为绝对路径（相对路径相对 schema 目录，与 Prisma 一致） */
function resolveDbPath() {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:")) {
    console.error(`❌ 仅支持 SQLite file: 形式的 DATABASE_URL，当前：${url}`);
    process.exit(1);
  }
  const p = url.slice("file:".length).split("?")[0];
  return path.isAbsolute(p) ? p : path.resolve(schemaDir, p);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const dbPath = resolveDbPath();

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 数据库不存在：${dbPath}`);
  console.error("   请先运行 pnpm db:sync 或 pnpm dev 生成数据库。");
  process.exit(1);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// WAL checkpoint：把 -wal 中的事务合并回主库文件并截断 WAL。
// server 运行中写锁繁忙时 TRUNCATE 可能暂时无法完成（busy=1），重试若干次；
// 仍繁忙则中止并报错，绝不产生静默不完整的备份。
const prisma = new PrismaClient();
try {
  let busy = 1;
  for (let attempt = 1; attempt <= 5 && busy; attempt++) {
    const rows = await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
    busy = Number(rows?.[0]?.busy ?? 0);
    if (busy && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (busy) {
    console.error("❌ WAL checkpoint 持续被写锁占用（server 正在写入），请稍后重试。");
    console.error("   备份已中止，未产生可能不完整的副本。");
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const dest = path.join(backupDir, `dev-${timestamp()}.db`);
fs.copyFileSync(dbPath, dest);

const stat = fs.statSync(dest);
console.log(`✅ 备份完成：${dest} (${(stat.size / 1024).toFixed(1)} KB)`);
