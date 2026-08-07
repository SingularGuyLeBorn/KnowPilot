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
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 开发编排脚本先于任何 pnpm 子进程运行，需先加载根目录 .env，
 *  否则 ONEBOT_QQ_ACCOUNT 等配置无法被 dev.mjs 自身读取（子进程也继承不到）。
 *  行为对齐 server 的 loadRootEnv：已存在的环境变量不覆盖。 */
function loadRootEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    console.log(`  ℹ️  未找到根目录 .env (${envPath})，跳过环境变量预加载`);
    return;
  }
  const content = fs.readFileSync(envPath, "utf8");
  let loaded = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // 去除单/双引号包裹（与 dotenv 一致）
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  console.log(`  ✅ 已加载根目录 .env：${loaded} 个键（已存在环境变量不覆盖）`);
  if (process.env.ONEBOT_QQ_ACCOUNT) {
    const autoOpen = process.env.ONEBOT_QQ_AUTO_OPEN !== "false";
    console.log(`  🤖 检测到 ONEBOT_QQ_ACCOUNT=${process.env.ONEBOT_QQ_ACCOUNT}，${autoOpen ? "将自动打开 QQ/NapCat 实例" : "自动打开已关闭，仅连接已运行实例"}`);
  } else {
    console.log(`  ℹ️  未配置 ONEBOT_QQ_ACCOUNT，NapCat 不会自动启动`);
  }
}
loadRootEnv();

const healthUrl = process.env.SERVER_INTERNAL_URL
  ? `${process.env.SERVER_INTERNAL_URL.replace(/\/$/, "")}/health`
  : "http://127.0.0.1:3010/health";

/** 避免 shell:true + args 触发 Node DEP0190；Windows 上直接 spawn pnpm 会 ENOENT/EINVAL */
const pnpmJs = path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");
/** 非 corepack 安装的 pnpm（如 npm i -g pnpm / scoop）没有该路径，回退 shell 模式调 PATH 中的 pnpm */
const pnpmJsExists = fs.existsSync(pnpmJs);

function spawnPnpm(args, opts = {}) {
  const base = {
    cwd: opts.cwd ?? root,
    stdio: opts.stdio ?? "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  };
  if (pnpmJsExists) {
    return spawn(process.execPath, [pnpmJs, ...args], { ...base, shell: false });
  }
  return spawn("pnpm", args, { ...base, shell: true });
}

const quick = process.argv.includes("--quick");
const skipSync = process.argv.includes("--no-sync");
const webScript = process.argv.includes("--remote") ? "dev:remote" : "dev";

/** @type {import('child_process').ChildProcess[]} */
const children = [];

/** shutdown 时调用的清理函数集合（阻止 spawnService 的重启定时器在退出后 spawn 孤儿进程） */
const disposedServices = new Set();

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

async function getProcessCommandLine(pid) {
  try {
    const { stdout } = await execAsync(`wmic process where "ProcessId=${pid}" get CommandLine /format:csv`);
    if (stdout.trim()) return stdout;
  } catch {
    /* fallback to powershell */
  }
  try {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`);
    return stdout || "";
  } catch {
    return "";
  }
}

/** 探测 OneBot /get_login_info 返回的当前登录 QQ */
async function fetchOneBotSelfId(url, timeoutMs = 3000) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/get_login_info`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json();
    const selfId = String(data.data?.user_id ?? data.data?.self_id ?? "");
    return selfId || null;
  } catch {
    return null;
  }
}

/** 用 Node  net 快速探测端口是否可被监听（占用 / 权限问题 均视为不可用） */
function isTcpPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * 为 NapCat 新实例解析可用的 OneBot HTTP URL。
 *  - 若当前 ONEBOT_HTTP_URL 上已是目标账号，则无需启动新实例。
 *  - 若该端口已被占用（或返回非目标账号），自动向后寻找 3001~3099 的空闲端口。
 */
async function resolveOneBotHttpUrl(targetAccount) {
  const configuredUrl = (process.env.ONEBOT_HTTP_URL || "http://127.0.0.1:3001").trim();
  let urlObj;
  try {
    urlObj = new URL(configuredUrl);
  } catch {
    console.log(`  ⚠️  ONEBOT_HTTP_URL 格式非法（${configuredUrl}），回退到 127.0.0.1:3001`);
    urlObj = new URL("http://127.0.0.1:3001");
  }
  const isLocal = urlObj.hostname === "127.0.0.1" || urlObj.hostname === "localhost";

  const existingSelfId = await fetchOneBotSelfId(configuredUrl, 3000);
  if (existingSelfId === targetAccount) {
    console.log(`  ✅ 目标 QQ ${targetAccount} 已在 ${configuredUrl} 在线，无需多开`);
    return { url: configuredUrl, alreadyOnline: true };
  }

  if (!isLocal) {
    console.log(`  ℹ️  ONEBOT_HTTP_URL 为非本地地址 ${configuredUrl}，跳过本地端口分配`);
    return { url: configuredUrl, alreadyOnline: false };
  }

  const configuredPort = Number(urlObj.port) || 3001;
  let startPort = configuredPort;
  if (existingSelfId) {
    console.log(`  ⚠️  ${configuredUrl} 已被 QQ ${existingSelfId} 占用，将为新实例分配端口`);
    startPort = configuredPort + 1;
  } else if (!(await isTcpPortFree(configuredPort))) {
    console.log(`  ⚠️  ${configuredUrl} 端口被占用，将为新实例分配端口`);
    startPort = configuredPort + 1;
  }

  for (let port = startPort; port < 3100; port++) {
    if (await isTcpPortFree(port)) {
      const url = `http://127.0.0.1:${port}`;
      console.log(`  ✅ 为新 NapCat 实例分配 OneBot HTTP 端口 ${port}`);
      return { url, alreadyOnline: false };
    }
  }
  throw new Error("未找到空闲的 OneBot HTTP 端口（3001-3099）");
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

    const cmdStdout = await getProcessCommandLine(listeningPid);
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
    const cmdStdout = await getProcessCommandLine(listeningPid);
    if (!cmdStdout.includes("next") || !cmdStdout.includes(root)) return;

    console.log(`\n  ⚠️  检测到遗留 Next.js dev 进程 PID ${listeningPid}，正在清理…`);
    await execAsync(`taskkill /pid ${listeningPid} /T /F`).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} label
 * @param {string[]} args
 * @param {{ fatal?: boolean; restart?: boolean; maxRestarts?: number }} [opts]
 * - fatal: 退出则整栈关闭（仅 server）
 * - restart: 非 0 退出时自动重启（web 常用；避免 next 被孤儿互杀后拖死后端）
 */
function spawnService(label, args, opts = {}) {
  const fatal = opts.fatal !== false;
  const restart = opts.restart === true;
  const maxRestarts = opts.maxRestarts ?? 3;
  let restarts = 0;
  let disposed = false;
  let backoffMs = 1500;

  const start = () => {
    if (disposed) return;
    console.log(`\n  ▶ [${label}] 启动…\n`);
    const child = spawnPnpm(args);
    child.on("exit", (code, signal) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);

      if (signal) {
        console.error(`\n  ✖ [${label}] 被信号终止 (${signal})`);
        if (fatal) shutdown("EXIT");
        return;
      }
      if (code === 0 || code === null) return;

      console.error(`\n  ✖ [${label}] 意外退出 (code=${code})`);
      if (fatal) {
        shutdown("EXIT");
        return;
      }
      // web / sync / server：不拖死整栈。常见根因是「Another next already running」多实例互杀或后端未捕获异常。
      if (restart && (maxRestarts === Infinity || restarts < maxRestarts) && !disposed) {
        restarts += 1;
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        console.error(
          `  ↻ [${label}] ${maxRestarts === Infinity ? `第 ${restarts} 次` : `${restarts}/${maxRestarts}`} 次重启，${delay}ms 后…（若反复失败：关掉其他 pnpm/IDE 终端，再 taskkill /F /T 清端口）`,
        );
        setTimeout(start, delay);
        return;
      }
      console.error(
        `  ⚠️  [${label}] 已退出但后端继续运行。请检查是否有多个 next / pnpm dev 在抢端口 3000。`,
      );
    });
    children.push(child);
    return child;
  };

  // shutdown 时标记 disposed，阻止重启定时器在进程退出后仍 spawn 新子进程（孤儿进程）
  disposedServices.add(() => { disposed = true; });

  return start();
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
  // 先标记所有 spawnService disposed，阻止重启定时器在进程退出后 spawn 新子进程
  for (const dispose of disposedServices) {
    try { dispose(); } catch { /* ignore */ }
  }
  disposedServices.clear();

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

  // 若配置了 OneBot 指定 QQ 账号：拉起 NapCat（已在线则进掉线守护），脚本崩溃时指数退避重启
  if (process.env.ONEBOT_QQ_ACCOUNT && process.env.ONEBOT_ENABLED !== "false") {
    const { url, alreadyOnline } = await resolveOneBotHttpUrl(process.env.ONEBOT_QQ_ACCOUNT);
    process.env.ONEBOT_HTTP_URL = url;
    if (alreadyOnline) {
      console.log(`  ℹ️  目标 QQ 已在线，仍启动 NapCat 守护进程监控掉线重登`);
    }
    spawnService("napcat", ["napcat"], {
      fatal: false,
      restart: true,
      maxRestarts: Infinity,
    });
  }

  // server 意外退出（如未捕获异常/历史 Tesseract Worker 崩进程）自动拉起，不拖死整栈；
  // 指数退避无限重启：后端是核心，必须持续可用。
  spawnService("server", ["--filter", "@knowpilot/server", "dev"], {
    fatal: false,
    restart: true,
    maxRestarts: Infinity,
  });
  await waitForHealth(healthUrl);

  await killOrphanNextDev();
  // web 挂了自动重启，不拖死 server（多实例互杀时常见）
  spawnService("web", ["--filter", "@knowpilot/web", webScript], {
    fatal: false,
    restart: true,
    maxRestarts: 5,
  });

  if (!quick) {
    // sync watch 挂了只告警，不拖死整栈
    spawnService("sync", ["--filter", "@knowpilot/server", "db:sync:watch"], { fatal: false });
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
