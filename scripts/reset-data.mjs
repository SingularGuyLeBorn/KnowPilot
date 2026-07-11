#!/usr/bin/env node
/**
 * 一键清除本地运行时数据（不可逆）
 *
 * 清除范围：
 *   - SQLite：apps/server/prisma/*.db(+shm/wal)
 *   - workspaces/ 下全部工作区目录
 *   - content/ 各实体目录内文件（保留 .gitkeep）
 *   - .dev-log / .test-content* / E2E 残留
 *
 * 默认保留 content/posts 与 content/about（博客花园）。
 * 加 --all 时连文章与 About 一并清空。
 *
 * 用法：
 *   pnpm data:reset -- --yes
 *   pnpm data:reset -- --yes --all
 *   pnpm data:reset -- --yes --seed   # 清空后写入示例文章种子
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const yes = args.has("--yes") || args.has("-y");
const includePosts = args.has("--all");
const runSeed = args.has("--seed");

/** content 下始终清理的运行时实体目录 */
const RUNTIME_CONTENT_DIRS = [
  "agents",
  "approvals",
  "files",
  "git",
  "logs",
  "mcp",
  "memories",
  "messages",
  "prompts",
  "sessions",
  "skills",
  "sources",
  "tasks",
  "tools",
  "triggers",
  "uploads",
  "workspace",
];

const EXTRA_PATHS = [
  ".dev-log",
  ".test-content",
  ".test-content-e2e",
  ".test-e2e-pids.json",
  "apps/web/e2e/test-results",
  "apps/web/e2e/test-results-mock",
  "apps/web/e2e/playwright-report",
  "apps/web/e2e/playwright-report-mock",
];

function rel(p) {
  return path.relative(root, p).replaceAll("\\", "/");
}

function rmQuiet(target) {
  if (!fs.existsSync(target)) return false;
  try {
    const st = fs.lstatSync(target);
    if (st.isDirectory()) {
      // Windows 上对含中文路径的 fs.rmSync({recursive}) 可能直接进程崩溃，改为逐项 unlink/rmdir
      for (const name of fs.readdirSync(target)) {
        rmQuiet(path.join(target, name));
      }
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
    return true;
  } catch (err) {
    console.warn(`  跳过 ${rel(target)}：${err instanceof Error ? err.message : err}`);
    return false;
  }
}

function ensureGitkeep(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const keep = path.join(dir, ".gitkeep");
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
}

/** 清空目录内文件，保留根目录 .gitkeep */
function clearDirKeepGitkeep(dir) {
  if (!fs.existsSync(dir)) {
    ensureGitkeep(dir);
    return 0;
  }
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name === ".gitkeep") continue;
    if (rmQuiet(path.join(dir, name))) removed += 1;
  }
  ensureGitkeep(dir);
  return removed;
}

function clearPrismaDbs() {
  const prismaDir = path.join(root, "apps/server/prisma");
  let n = 0;
  if (!fs.existsSync(prismaDir)) return n;
  for (const name of fs.readdirSync(prismaDir)) {
    if (!/\.db(-shm|-wal)?$/i.test(name)) continue;
    if (rmQuiet(path.join(prismaDir, name))) {
      console.log(`  删除 ${rel(path.join(prismaDir, name))}`);
      n += 1;
    }
  }
  return n;
}

function clearWorkspaces() {
  const wsRoot = path.join(root, "workspaces");
  fs.mkdirSync(wsRoot, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(wsRoot)) {
    const full = path.join(wsRoot, name);
    if (rmQuiet(full)) {
      console.log(`  删除 workspaces/${name}`);
      n += 1;
    }
  }
  return n;
}

function clearContent() {
  let entries = 0;
  const dirs = [...RUNTIME_CONTENT_DIRS];
  if (includePosts) dirs.push("posts");

  for (const name of dirs) {
    const dir = path.join(root, "content", name);
    const n = clearDirKeepGitkeep(dir);
    if (n > 0) console.log(`  清空 content/${name}/（${n} 项）`);
    entries += n;
  }

  if (includePosts) {
    const about = path.join(root, "content/about/profile.md");
    if (fs.existsSync(about)) {
      fs.writeFileSync(
        about,
        [
          "---",
          'title: "About"',
          "---",
          "",
          "（已重置）",
          "",
        ].join("\n"),
        "utf8",
      );
      console.log("  重置 content/about/profile.md");
      entries += 1;
    }
  } else {
    console.log("  保留 content/posts/ 与 content/about/（加 --all 可一并清空）");
  }

  return entries;
}

function clearExtras() {
  let n = 0;
  for (const p of EXTRA_PATHS) {
    const full = path.join(root, p);
    if (rmQuiet(full)) {
      console.log(`  删除 ${p}`);
      n += 1;
    }
  }
  return n;
}

function recreateDb() {
  console.log("\n→ 重建空数据库（prisma db push）…");
  const r = spawnSync(
    "pnpm",
    ["--filter", "@knowpilot/server", "exec", "prisma", "db", "push", "--accept-data-loss"],
    { cwd: root, stdio: "inherit", shell: true },
  );
  if (r.status !== 0) {
    throw new Error(`prisma db push 失败（exit ${r.status}）`);
  }
}

function seedDb() {
  console.log("\n→ 写入种子数据（db:seed）…");
  const r = spawnSync("pnpm", ["db:seed"], { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    throw new Error(`db:seed 失败（exit ${r.status}）`);
  }
}

function askConfirm() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const scope = includePosts
      ? "数据库 + workspaces + content 全部实体（含 posts/about）"
      : "数据库 + workspaces + 运行时 content（保留 posts/about）";
    rl.question(
      `\n⚠️  即将清除：${scope}\n   此操作不可逆。输入 yes 继续：`,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      },
    );
  });
}

async function main() {
  console.log("KnowPilot data:reset");
  console.log(`根目录: ${root}`);
  if (includePosts) console.log("模式: --all（含文章与 About）");
  if (runSeed) console.log("清空后将执行 db:seed");

  if (!yes) {
    const ok = await askConfirm();
    if (!ok) {
      console.log("已取消。");
      process.exit(0);
    }
  } else {
    console.log("已带 --yes，跳过交互确认。");
  }

  console.log("\n→ 清除 SQLite…");
  clearPrismaDbs();

  console.log("\n→ 清除 workspaces…");
  clearWorkspaces();

  console.log("\n→ 清除 content…");
  clearContent();

  console.log("\n→ 清除开发/测试残留…");
  clearExtras();

  recreateDb();
  if (runSeed) seedDb();

  console.log("\n✅ 数据已清除。下次 pnpm dev 会按需重建超级 Agent / 系统 Workspace。");
  if (!includePosts) {
    console.log("   若也要清空文章：pnpm data:reset -- --yes --all");
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
