#!/usr/bin/env node
/**
 * SQLite 数据库备份 — L5-M04
 *
 * 将 apps/server/prisma/dev.db 复制到 backups/ 目录，文件名含时间戳。
 * 用法：pnpm db:backup
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.join(projectRoot, "apps/server/prisma/dev.db");
const backupDir = path.join(projectRoot, "backups");

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 数据库不存在：${dbPath}`);
  console.error("   请先运行 pnpm db:sync 或 pnpm dev 生成 dev.db。");
  process.exit(1);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const dest = path.join(backupDir, `dev-${timestamp()}.db`);
fs.copyFileSync(dbPath, dest);

const stat = fs.statSync(dest);
console.log(`✅ 备份完成：${dest} (${(stat.size / 1024).toFixed(1)} KB)`);
