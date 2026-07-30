#!/usr/bin/env node
/**
 * 一键远程：dev + ngrok 固定域名隧道。
 *
 * 用法:
 *   pnpm dev:ngrok          # 启动 ngrok（NGROK_DOMAIN）+ dev（server+web）
 *   pnpm dev:ngrok --quick  # 跳过 db:sync
 *
 * 前提：.env 已配 NGROK_DOMAIN（免费 dev domain，如 xxx.ngrok-free.dev）
 *       ngrok 已 `ngrok config add-authtoken <token>`
 *
 * server 启动时会读 PUBLIC_URL 自动注册 AgentMail webhook（邮件回复接收通道）。
 *
 * 鲁棒性：
 * - ngrok 进程异常退出 → 自动重启（指数退避 2s→4s→8s→…上限 60s），不杀 dev 栈
 * - dev 退出 → 整栈停（dev 是核心）
 * - 隧道就绪后自检：从公网 ping webhook URL，确认真的通
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 解析 ngrok 可执行文件路径：优先项目内 scripts/ngrok.exe（不依赖系统 PATH），
 * 回退到系统 PATH 的 `ngrok`。这样即使系统未装 ngrok，只要项目内放一份二进制即可用。
 */
function resolveNgrokBin() {
  const local = process.platform === "win32" ? path.join(root, "scripts", "ngrok.exe") : path.join(root, "scripts", "ngrok");
  if (fs.existsSync(local)) return local;
  return "ngrok";
}
const ngrokBin = resolveNgrokBin();

function loadDotEnv(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

const env = loadDotEnv(path.join(root, ".env"));
const ngrokDomain = env.NGROK_DOMAIN || process.env.NGROK_DOMAIN;
const publicUrl = env.PUBLIC_URL || process.env.PUBLIC_URL;
const allowInsecureAuth = process.argv.includes("--allow-insecure-auth");

if (!ngrokDomain) {
  console.error("\n  ❌ .env 未配置 NGROK_DOMAIN。请先在 ngrok dashboard 领一个免费 dev domain，写入 .env:\n     NGROK_DOMAIN=xxx.ngrok-free.dev\n     PUBLIC_URL=https://xxx.ngrok-free.dev\n");
  process.exit(1);
}

{
  const authMode = (env.AUTH_MODE || process.env.AUTH_MODE || "none").toLowerCase();
  const password = (env.AUTH_PASSWORD || process.env.AUTH_PASSWORD || "").trim();
  if (!(authMode === "password" && password)) {
    if (allowInsecureAuth || process.env.KP_ALLOW_INSECURE_PUBLIC === "1") {
      console.warn(
        "\n  ⚠️ [安全] 未启用 AUTH_MODE=password，但已用 --allow-insecure-auth / KP_ALLOW_INSECURE_PUBLIC=1 强制继续。\n",
      );
    } else {
      console.error("\n  ❌ 拒绝启动 ngrok 远程：公网暴露必须启用密码鉴权。");
      console.error("     在 .env 设置 AUTH_MODE=password 与 AUTH_PASSWORD");
      console.error("     或临时: pnpm dev:ngrok --allow-insecure-auth\n");
      process.exit(1);
    }
  }
}

const quick = process.argv.includes("--quick");

/** @type {import('child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;
let ngrokProc = null;
let ngrokReady = false;
let ngrokRestartAttempts = 0;
let ngrokRestartTimer = null;
let selfCheckDone = false;

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ngrokRestartTimer) clearTimeout(ngrokRestartTimer);
  console.log(`\n  👋 停止远程栈 (${reason})…`);
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  // Windows 下 SIGTERM 可能不够，补 taskkill
  if (process.platform === "win32") {
    for (const child of children) {
      if (!child.pid || child.killed) continue;
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  }
  setTimeout(() => process.exit(0), 800);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function startNgrok() {
  console.log(`  ▶ 启动 ngrok（${ngrokDomain} → localhost:3000）…`);
  ngrokReady = false;
  ngrokProc = spawn(ngrokBin, ["http", "3000", `--url=${ngrokDomain}`, "--log=stdout"], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: ngrokBin === "ngrok",
  });
  children.push(ngrokProc);

  ngrokProc.stdout?.on("data", (buf) => {
    const text = buf.toString();
    if (/client session established|started tunnel/i.test(text)) {
      ngrokReady = true;
      ngrokRestartAttempts = 0;
      console.log(`  ✅ ngrok 隧道已建立: https://${ngrokDomain} → localhost:3000`);
      if (!selfCheckDone) {
        selfCheckDone = true;
        // 隧道就绪后延迟自检（给 server 启动时间）
        setTimeout(() => selfCheck(), 8000);
      }
    }
  });

  ngrokProc.on("exit", (code) => {
    if (shuttingDown) return;
    // 从 children 移除已退出的 ngrok
    const idx = children.indexOf(ngrokProc);
    if (idx >= 0) children.splice(idx, 1);
    console.warn(`\n  ⚠️ ngrok 退出 (code=${code})，${ngrokReady ? "隧道断线" : "启动失败"}，自动重启中…`);
    scheduleNgrokRestart();
  });
}

function scheduleNgrokRestart() {
  if (shuttingDown) return;
  ngrokRestartAttempts++;
  // 指数退避：2s → 4s → 8s → 16s → 32s → 60s（上限）
  const backoff = Math.min(2000 * Math.pow(2, ngrokRestartAttempts - 1), 60_000);
  console.log(`  ⏳ ${Math.round(backoff / 1000)}s 后第 ${ngrokRestartAttempts} 次重启 ngrok…`);
  ngrokRestartTimer = setTimeout(() => {
    startNgrok();
  }, backoff);
}

async function selfCheck() {
  if (shuttingDown) return;
  const url = `https://${ngrokDomain}/api/webhooks/agentmail`;
  try {
    // webhook 端点是 POST，用 GET 探测会返回 404/405 但说明隧道通；改探 /health 更稳
    const healthUrl = `https://${ngrokDomain}/api/trpc/ai.about`;
    const res = await fetch(healthUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    if (res.ok || res.status === 404 || res.status === 405 || res.status < 500) {
      console.log(`  ✅ 隧道自检通过：公网可访问 ${ngrokDomain}（HTTP ${res.status}）`);
    } else {
      console.warn(`  ⚠️ 隧道自检异常：HTTP ${res.status}（可能 server 还在启动）`);
    }
  } catch (err) {
    console.warn(`  ⚠️ 隧道自检失败：${err instanceof Error ? err.message : err}（ngrok 可能还在握手，webhook 注册会在 server 侧重试）`);
  }
}

async function main() {
  console.log(`\n  🚀 KnowPilot Remote (ngrok + dev)\n`);
  console.log(`  ngrok domain: ${ngrokDomain}`);
  console.log(`  PUBLIC_URL:   ${publicUrl || "(未配)"}\n`);

  // 1. 启动 ngrok（固定域名 → localhost:3000）
  startNgrok();

  // 2. 启动 dev（server + web + sync:watch）
  const devArgs = [];
  if (quick) devArgs.push("--quick");
  const dev = spawn(process.execPath, [path.join(root, "scripts/dev.mjs"), ...devArgs], {
    stdio: "inherit",
    env: { ...process.env, PUBLIC_URL: publicUrl || `https://${ngrokDomain}` },
  });
  children.push(dev);
  dev.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n  ✖ dev 退出 (code=${code}, signal=${signal})`);
    shutdown("DEV_EXIT");
  });

  console.log("\n══════════════════════════════════════════════════");
  console.log("  🌐 KnowPilot 远程已就绪");
  console.log(`  公网地址: https://${ngrokDomain}`);
  console.log("  本机 Web:  http://localhost:3000");
  console.log("  Server:   http://localhost:3010");
  console.log("══════════════════════════════════════════════════");
  console.log("  邮件 webhook: https://" + ngrokDomain + "/api/webhooks/agentmail");
  console.log("  server 启动时会自动注册到 AgentMail");
  console.log("  ngrok 断线会自动重启（不杀 dev 栈）");
  console.log("  按 Ctrl+C 同时停止 ngrok + dev\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(`\n  ❌ 远程启动失败: ${err.message}\n`);
    shutdown("ERROR");
    process.exit(1);
  });
}
