#!/usr/bin/env node
/**
 * 降低本机启动摩擦：确保 .env 有开发默认值（不覆盖已有非空值）。
 * - 生成 CREDENTIAL_MASTER_KEY（若缺失）
 * - EMAIL_PROVIDER=none（跳过邮件/webhook）
 * - 提示本地 Ollama（不强制启动）
 *
 * 用法：pnpm setup:dev
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

function parseEnv(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function ensureLine(lines, key, value, comment) {
  const re = new RegExp(`^\\s*#?\\s*${key}\\s*=`);
  const idx = lines.findIndex((l) => re.test(l));
  const entry = `${key}=${value}`;
  if (idx >= 0) {
    const cur = lines[idx];
    if (cur.trim().startsWith("#") || !cur.includes("=") || /=(\s*)$/.test(cur) || /=\s*$/.test(cur.trim())) {
      lines[idx] = entry;
      return `updated ${key}`;
    }
    const eq = cur.indexOf("=");
    const existing = cur.slice(eq + 1).trim();
    if (!existing || existing === '""' || existing === "''") {
      lines[idx] = entry;
      return `filled ${key}`;
    }
    return `kept ${key}`;
  }
  if (comment) lines.push("", `# ${comment}`, entry);
  else lines.push("", entry);
  return `appended ${key}`;
}

function main() {
  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
      console.log("  ✓ 已从 .env.example 创建 .env");
    } else {
      fs.writeFileSync(envPath, "", "utf8");
      console.log("  ✓ 已创建空 .env");
    }
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const map = parseEnv(raw);
  const lines = raw.split(/\r?\n/);
  const actions = [];

  if (!map.get("CREDENTIAL_MASTER_KEY")?.trim()) {
    const key = crypto.randomBytes(32).toString("hex");
    actions.push(ensureLine(lines, "CREDENTIAL_MASTER_KEY", key, "开发凭据加密主密钥（setup:dev 自动生成）"));
  } else {
    actions.push("kept CREDENTIAL_MASTER_KEY");
  }

  const email = map.get("EMAIL_PROVIDER")?.trim();
  if (!email || email === "agentmail") {
    // 仅在未设或仍为示例 agentmail 时改为 none；用户已显式 smtp/ntfy 则保留
    if (!email) {
      actions.push(ensureLine(lines, "EMAIL_PROVIDER", "none", "快速模式：跳过邮件/webhook"));
    } else {
      actions.push("kept EMAIL_PROVIDER");
    }
  } else {
    actions.push(`kept EMAIL_PROVIDER=${email}`);
  }

  if (!map.get("AUTH_MODE")?.trim()) {
    actions.push(ensureLine(lines, "AUTH_MODE", "none", "本地开发默认无鉴权"));
  }

  if (!map.get("DATABASE_URL")?.trim()) {
    actions.push(
      ensureLine(lines, "DATABASE_URL", '"file:./dev.db"', "SQLite（相对 apps/server/prisma）"),
    );
  }

  fs.writeFileSync(envPath, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");

  console.log("\n  KnowPilot setup:dev\n");
  for (const a of actions) console.log(`  · ${a}`);
  console.log(`
  下一步：
    pnpm install
    pnpm db:sync
    pnpm dev:quick          # 跳过全量 sync 的较快启动（已有库时）
    # 或 pnpm dev

  本地模型（可选）：
    1) 安装并启动 Ollama → ollama pull llama3.2
    2) Chat 模型菜单 →「本地模型」
    3) 或 .env：LLM_DEFAULT_PROVIDER=ollama
               DEFAULT_LLM_MODEL=ollama/llama3.2

  邮件/webhook 默认 EMAIL_PROVIDER=none；需要审批邮件时再改 agentmail/smtp。
`);
}

main();
