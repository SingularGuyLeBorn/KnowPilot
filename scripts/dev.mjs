#!/usr/bin/env node
/**
 * 开发环境编排 — 分阶段启动，避免 concurrently + tsx watch 在 Windows 下卡死
 *
 * 1. db:sync（含 FTS，唯一全量重建入口）
 * 2. server（tsx watch，独立进程）
 * 3. 等待 /health 就绪
 * 4. web + sync:watch 并行
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const healthUrl = process.env.SERVER_INTERNAL_URL
  ? `${process.env.SERVER_INTERNAL_URL.replace(/\/$/, "")}/health`
  : "http://127.0.0.1:3010/health";

/** 避免 shell:true + args 触发 Node DEP0190；Windows 上直接 spawn pnpm 会 ENOENT/EINVAL */
const pnpmJs = path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");

function spawnPnpm(args, opts = {}) {
  return spawn(process.execPath, [pnpmJs, ...args], {
    cwd: opts.cwd ?? root,
    shell: false,
    stdio: opts.stdio ?? "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
}

const quick = process.argv.includes("--quick");
const skipSync = process.argv.includes("--no-sync");
const webScript = process.argv.includes("--remote") ? "dev:remote" : "dev";

/** @type {import('child_process').ChildProcess[]} */
const children = [];

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnPnpm(args, opts);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(" ")} 退出码 ${code}`));
    });
  });
}

function spawnService(label, args) {
  console.log(`\n  ▶ [${label}] 启动…\n`);
  const child = spawnPnpm(args);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code !== 0) {
      console.error(`\n  ✖ [${label}] 意外退出 (code=${code})`);
      shutdown("EXIT");
    }
  });
  children.push(child);
  return child;
}

async function waitForHealth(url, timeoutMs = 90_000) {
  const start = Date.now();
  process.stdout.write(`  ⏳ 等待后端就绪 ${url} …`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(" OK\n");
        return;
      }
    } catch {
      /* retry */
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("");
  throw new Error(`后端在 ${timeoutMs / 1000}s 内未就绪：${url}`);
}

function shutdown(reason) {
  if (children.length === 0) process.exit(0);
  console.log(`\n  👋 停止开发服务 (${reason})…`);
  for (const child of children) {
    if (!child.pid || child.killed) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  console.log("\n  🌱 KnowPilot Dev\n");

  if (!skipSync) {
    console.log("  📦 同步 content/ → SQLite（含 FTS）…\n");
    await run(["--filter", "@knowpilot/server", "db:sync"]);
  }

  spawnService("server", ["--filter", "@knowpilot/server", "dev"]);
  await waitForHealth(healthUrl);

  spawnService("web", ["--filter", "@knowpilot/web", webScript]);

  if (!quick) {
    spawnService("sync", ["--filter", "@knowpilot/server", "db:sync:watch"]);
  }

  console.log("  ✅ 开发环境已就绪");
  console.log("     Web:    http://localhost:3000");
  console.log("     Server: http://localhost:3010");
  console.log("     按 Ctrl+C 停止\n");
}

main().catch((err) => {
  console.error(`\n  ❌ 启动失败: ${err.message}\n`);
  shutdown("ERROR");
  process.exit(1);
});
