#!/usr/bin/env node
/**
 * 一键远程：dev(--remote) + Cloudflare Tunnel，打印公网 URL 与鉴权提醒。
 *
 * 用法:
 *   pnpm remote              # 临时 *.trycloudflare.com（默认）
 *   pnpm remote --named      # 使用 CLOUDFLARE_TUNNEL_TOKEN 或 cloudflare/config.yml
 *   pnpm remote --quick      # 跳过 db:sync（转发到 dev.mjs --quick）
 *   pnpm remote --no-sync    # 跳过首次 sync
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webOrigin = "http://127.0.0.1:3000";
const healthUrl = process.env.SERVER_INTERNAL_URL
  ? `${process.env.SERVER_INTERNAL_URL.replace(/\/$/, "")}/health`
  : "http://127.0.0.1:3010/health";

const named = process.argv.includes("--named");
const quick = process.argv.includes("--quick");
const noSync = process.argv.includes("--no-sync");

/** @type {import('child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;
let printedUrl = false;

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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
}

function findCloudflared() {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const out = execSync(`${which} cloudflared`, { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {
    /* fall through */
  }
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "cloudflared", "cloudflared.exe"),
    path.join(root, "cloudflare", "cloudflared.exe"),
    path.join(root, "cloudflare", "cloudflared"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function spawnNode(scriptRel, args, opts = {}) {
  const child = spawn(process.execPath, [path.join(root, scriptRel), ...args], {
    cwd: root,
    shell: false,
    stdio: opts.pipeStdout ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  children.push(child);
  return child;
}

function spawnBin(bin, args, opts = {}) {
  const child = spawn(bin, args, {
    cwd: root,
    shell: false,
    stdio: opts.pipeStdout ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  children.push(child);
  return child;
}

async function waitHttpOk(url, timeoutMs = 120_000, label = url) {
  const start = Date.now();
  process.stdout.write(`  ⏳ 等待 ${label} …`);
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
  throw new Error(`${label} 在 ${timeoutMs / 1000}s 内未就绪`);
}

/** @param {string} text */
export function extractTunnelUrl(text) {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

function printRemoteBanner(url, env) {
  const authMode = (env.AUTH_MODE || process.env.AUTH_MODE || "none").toLowerCase();
  console.log("\n══════════════════════════════════════════════════");
  console.log("  🌐 KnowPilot 远程已就绪");
  if (url) {
    console.log(`  公网地址: ${url}`);
  } else {
    console.log("  公网地址: （命名隧道请用你配置的域名 / PUBLIC_URL）");
  }
  console.log("  本机 Web:  http://localhost:3000");
  console.log("══════════════════════════════════════════════════");
  if (authMode === "none" || authMode === "") {
    console.log("  ⚠️  AUTH_MODE 未开启密码。公网暴露前请在 .env 设置:");
    console.log("     AUTH_MODE=password");
    console.log("     AUTH_PASSWORD=你的强密码");
  } else {
    console.log("  ✅ AUTH_MODE=password 已配置，手机打开后应先登录。");
  }
  if (url && !named) {
    console.log("  提示: 临时链接每次会变；同源 rewrite 一般无需改 PUBLIC_URL。");
    console.log("        若要在 /settings 显示公网地址，可写入 PUBLIC_URL 后重启。");
  }
  console.log("  按 Ctrl+C 同时停止开发服务与隧道\n");
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  👋 停止远程栈 (${reason})…`);
  for (const child of children) {
    if (!child.pid || child.killed) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 600);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  console.log("\n  🚀 KnowPilot Remote（dev + tunnel）\n");

  const env = loadDotEnv(path.join(root, ".env"));
  const cf = findCloudflared();
  if (!cf) {
    throw new Error("未找到 cloudflared。请运行: winget install Cloudflare.cloudflared");
  }
  console.log(`  cloudflared: ${cf}\n`);

  const devArgs = ["--remote"];
  if (quick) devArgs.push("--quick");
  if (noSync) devArgs.push("--no-sync");

  const dev = spawnNode("scripts/dev.mjs", devArgs);
  dev.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n  ✖ dev 退出 (code=${code}, signal=${signal})`);
    shutdown("DEV_EXIT");
  });

  await waitHttpOk(healthUrl, 120_000, "后端 /health");
  await waitHttpOk(webOrigin, 120_000, "前端 :3000");

  if (named) {
    const token = env.CLOUDFLARE_TUNNEL_TOKEN || process.env.CLOUDFLARE_TUNNEL_TOKEN;
    const configPath = path.join(root, "cloudflare", "config.yml");
    let tunnel;
    if (token) {
      console.log("  ▶ 启动命名隧道（CLOUDFLARE_TUNNEL_TOKEN）…\n");
      tunnel = spawnBin(cf, ["tunnel", "run", "--token", token]);
    } else if (fs.existsSync(configPath)) {
      console.log(`  ▶ 启动命名隧道（${configPath}）…\n`);
      tunnel = spawnBin(cf, ["tunnel", "--config", configPath, "run"]);
    } else {
      throw new Error(
        "命名模式需要 .env 中 CLOUDFLARE_TUNNEL_TOKEN，或 cloudflare/config.yml。也可用默认临时模式: pnpm remote",
      );
    }
    tunnel.on("exit", (code) => {
      if (shuttingDown) return;
      console.error(`\n  ✖ tunnel 退出 (code=${code})`);
      shutdown("TUNNEL_EXIT");
    });
    printRemoteBanner(env.PUBLIC_URL || process.env.PUBLIC_URL || null, env);
    return;
  }

  console.log(`  ▶ 启动临时隧道 → ${webOrigin}\n`);
  const tunnel = spawnBin(cf, ["tunnel", "--url", webOrigin], { pipeStdout: true });

  const onChunk = (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    if (printedUrl) return;
    const url = extractTunnelUrl(text);
    if (url) {
      printedUrl = true;
      printRemoteBanner(url, env);
    }
  };
  tunnel.stdout?.on("data", onChunk);
  tunnel.stderr?.on("data", onChunk);

  tunnel.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n  ✖ tunnel 退出 (code=${code})`);
    shutdown("TUNNEL_EXIT");
  });

  // 若 45s 内未解析到 URL，仍打印鉴权提醒（cloudflared 输出格式偶发变化）
  setTimeout(() => {
    if (!printedUrl && !shuttingDown) {
      printedUrl = true;
      console.log("\n  （尚未从 cloudflared 输出解析到 trycloudflare.com，请向上滚动查看 URL）");
      printRemoteBanner(null, env);
    }
  }, 45_000);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error(`\n  ❌ 远程启动失败: ${err.message}\n`);
    shutdown("ERROR");
    process.exit(1);
  });
}
