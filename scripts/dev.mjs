#!/usr/bin/env node
/**
 * 开发环境编排 — 分阶段启动，避免 concurrently + tsx watch 在 Windows 下卡死
 *
 * 1. db:sync（含 FTS，唯一全量重建入口）
 * 2. server（tsx watch，独立进程）
 * 3. 等待 /health 就绪
 * 4. web + sync:watch 并行
 */

import { spawn, exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

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

const execAsync = promisify(exec);

function listeningPidOnPort(netstatStdout, port) {
  return netstatStdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 5 && parts[parts.length - 2] === "LISTENING")
    .filter((parts) => parts[1]?.endsWith(`:${port}`) || parts[1] === `0.0.0.0:${port}` || parts[1] === `[::]:${port}` || parts[1]?.includes(`:${port}`))
    .map((parts) => parts[parts.length - 1])[0];
}

/** 清理遗留的 KnowPilot server（占用 3010 会导致 health 误判旧进程、新 tsx watch 起不来） */
async function killOrphanServer(serverPort = 3010) {
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execAsync(`lsof -tiTCP:${serverPort} -sTCP:LISTEN`).catch(() => ({ stdout: "" }));
      const pid = stdout.trim().split(/\n/)[0];
      if (!pid) return;
      const { stdout: cmd } = await execAsync(`ps -p ${pid} -o args=`).catch(() => ({ stdout: "" }));
      if (!cmd.includes("tsx") && !cmd.includes("index.ts")) return;
      if (!cmd.includes("KnowPilot") && !cmd.includes("apps/server")) return;
      console.log(`\n  ⚠️  检测到遗留 Server 进程 PID ${pid}，正在清理…`);
      await execAsync(`kill -9 ${pid}`).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr ":${serverPort}"`);
    const listeningPid = listeningPidOnPort(stdout, serverPort);
    if (!listeningPid) return;

    const { stdout: cmdStdout } = await execAsync(
      `wmic process where "ProcessId=${listeningPid}" get CommandLine /format:csv`,
    );
    const isKnowPilotServer =
      (cmdStdout.includes("tsx") || cmdStdout.includes("index.ts")) &&
      (cmdStdout.includes(root) || cmdStdout.includes("KnowPilot") || cmdStdout.includes("apps\\server") || cmdStdout.includes("apps/server"));
    if (!isKnowPilotServer) return;

    console.log(`\n  ⚠️  检测到遗留 Server 进程 PID ${listeningPid}，正在清理…`);
    await execAsync(`taskkill /pid ${listeningPid} /T /F`).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
  } catch {
    /* ignore */
  }
}

/** 清理遗留的 Next.js dev 进程（Windows 下异常退出时 next dev 子进程可能存活并占用 3000 端口） */
async function killOrphanNextDev(webPort = 3000) {
  if (process.platform !== "win32") return;
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr ":${webPort}"`);
    const listeningPid = listeningPidOnPort(stdout, webPort);
    if (!listeningPid) return;

    // 仅清理确认为本项目的 Next.js dev server
    const { stdout: cmdStdout } = await execAsync(
      `wmic process where "ProcessId=${listeningPid}" get CommandLine /format:csv`,
    );
    if (!cmdStdout.includes("next") || !cmdStdout.includes(root)) return;

    console.log(`\n  ⚠️  检测到遗留 Next.js dev 进程 PID ${listeningPid}，正在清理…`);
    await execAsync(`taskkill /pid ${listeningPid} /T /F`).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
  } catch {
    /* ignore */
  }
}

function spawnService(label, args) {
  console.log(`\n  ▶ [${label}] 启动…\n`);
  const child = spawnPnpm(args);
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`\n  ✖ [${label}] 被信号终止 (${signal})`);
      shutdown("EXIT");
      return;
    }
    if (code !== 0 && code !== null) {
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

  // 先清遗留 3010，避免 health 命中僵尸进程、新 server 绑定失败却误报「就绪」
  await killOrphanServer(3010);

  spawnService("server", ["--filter", "@knowpilot/server", "dev"]);
  await waitForHealth(healthUrl);

  await killOrphanNextDev();
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
