/**
 * 项目重置初始化：清空 SQLite + 运行时状态，再 schema push / sync / Swarm 初始化。
 * 保留 content/posts、skills、mcp、sources、prompts、about、memories 等 Markdown 源文件。
 *
 * 用法: node apps/server/scripts/reset-init.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(serverRoot, "../..");
const prismaDir = path.join(serverRoot, "prisma");
const workspacesDir = path.join(projectRoot, "workspaces");
const agentsDir = path.join(projectRoot, "content", "agents");

function rmQuiet(p) {
  try {
    if (!fs.existsSync(p)) return;
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    console.log(`  🗑  ${path.relative(projectRoot, p)}`);
  } catch (e) {
    console.warn(`  ⚠️  删除失败 ${p}:`, e.message);
  }
}

console.log("\n=== KnowPilot 重置初始化 ===\n");

console.log("1) 清空 SQLite…");
for (const f of fs.readdirSync(prismaDir)) {
  if (/\.db(-shm|-wal)?$/i.test(f)) rmQuiet(path.join(prismaDir, f));
}

console.log("\n2) 清空 workspaces/…");
if (fs.existsSync(workspacesDir)) {
  for (const name of fs.readdirSync(workspacesDir)) {
    rmQuiet(path.join(workspacesDir, name));
  }
}
fs.mkdirSync(workspacesDir, { recursive: true });

console.log("\n3) 清理 content/agents 运行时残留（保留 assistant.md）…");
if (fs.existsSync(agentsDir)) {
  for (const name of fs.readdirSync(agentsDir)) {
    if (name === ".gitkeep" || name === "assistant.md") continue;
    rmQuiet(path.join(agentsDir, name));
  }
}

console.log("\n4) 清理测试产物…");
for (const rel of [".test-content", ".test-content-e2e", ".test-e2e-pids.json"]) {
  rmQuiet(path.join(projectRoot, rel));
}

console.log("\n5) prisma db push --force-reset + generate…");
execSync("pnpm exec prisma db push --force-reset --skip-generate", {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});
execSync("pnpm exec prisma generate", {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});

console.log("\n6) db:sync（content → SQLite）…");
execSync("pnpm exec tsx src/scripts/sync.ts", {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});

console.log("\n7) Swarm 初始化…");
execSync("pnpm exec tsx scripts/init-swarm-once.ts", {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});

console.log("\n✅ 重置完成。可执行 pnpm dev 启动。");
console.log("已保留: content/posts、skills、mcp、sources、prompts、about、memories");
console.log("已清空: SQLite、workspaces/、运行时子 Agent、测试产物\n");
