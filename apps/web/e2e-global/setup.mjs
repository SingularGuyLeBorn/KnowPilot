import { execSync, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "../../server");
const webDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(__dirname, "../../..");

export const TEST_DB_NAME = "test-e2e.db";
export const TEST_DB_URL = `file:./${TEST_DB_NAME}`;
export const TEST_CONTENT_DIR = path.join(projectRoot, ".test-content-e2e");
const PID_FILE = path.join(projectRoot, ".test-e2e-pids.json");

const CONTENT_SUBDIRS = [
  "posts",
  "agents",
  "skills",
  "mcp",
  "memories",
  "tasks",
  "prompts",
  "sources",
  "uploads",
  "about",
];

function getE2EPorts() {
  return {
    serverPort: parseInt(process.env.E2E_SERVER_PORT || "3010", 10),
    webPort: parseInt(process.env.E2E_WEB_PORT || "3002", 10),
  };
}

export function killStaleTestProcesses() {
  const { serverPort, webPort } = getE2EPorts();
  killProcessesOnPorts([serverPort, webPort]);
}

function killProcessesOnPorts(ports) {
  let output = "";
  try {
    output = execSync("netstat -ano", { encoding: "utf8", timeout: 15000 });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== "TCP") continue;
    if (parts[3] !== "LISTENING") continue;

    const local = parts[1];
    const pid = parseInt(parts[parts.length - 1], 10);
    if (!pid || pid <= 0) continue;

    for (const port of ports) {
      if (local.endsWith(`:${port}`)) pids.add(pid);
    }
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore", timeout: 10000 });
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDbFiles(targetDir, dbName) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let failed = false;
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.rmSync(path.join(targetDir, `${dbName}${suffix}`), { force: true });
      } catch {
        failed = true;
      }
    }
    if (!failed) return;
    killStaleTestProcesses();
    await sleep(500);
  }
}

function getPrismaCli() {
  const candidates = [
    path.join(serverDir, "node_modules", "prisma", "build", "index.js"),
    path.join(projectRoot, "node_modules", "prisma", "build", "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err.message;
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 就绪超时 (${timeoutMs}ms): ${lastErr}`);
}

async function trpcQuery(serverPort, procedure, input = null) {
  const url = new URL(`http://127.0.0.1:${serverPort}/api/trpc/${procedure}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: input } }));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`tRPC ${procedure} HTTP ${res.status}`);
  const batch = await res.json();
  const first = batch[0];
  const errMsg = first?.error?.json?.message ?? first?.error?.message;
  if (errMsg) throw new Error(`tRPC ${procedure} error: ${errMsg}`);
  return first?.result?.data?.json;
}

async function trpcMutate(serverPort, procedure, input) {
  const res = await fetch(`http://127.0.0.1:${serverPort}/api/trpc/${procedure}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 0: { json: input } }),
  });
  if (!res.ok) throw new Error(`tRPC ${procedure} HTTP ${res.status}`);
  const batch = await res.json();
  const first = batch[0];
  const errMsg = first?.error?.json?.message ?? first?.error?.message;
  if (errMsg) throw new Error(`tRPC ${procedure} error: ${errMsg}`);
  return first?.result?.data?.json;
}

async function seedAssistantManager(serverPort) {
  const start = Date.now();
  let items = [];
  while (Date.now() - start < 30_000) {
    try {
      const list = await trpcQuery(serverPort, "agent.list", { page: 1, pageSize: 20 });
      items = list?.items ?? [];
      if (items.some((a) => a.tier === "super")) break;
    } catch {
      // 超级 Agent 可能还在初始化
    }
    await sleep(300);
  }
  const superAgent = items.find((a) => a.tier === "super");
  if (!superAgent) {
    throw new Error("[e2e globalSetup] 未找到超级 Agent，无法创建默认 manager");
  }
  const hasManager = items.some((a) => a.tier === "manager" && /assistant/i.test(a.name));
  if (hasManager) return;

  await trpcMutate(serverPort, "agent.create", {
    name: "assistant",
    tier: "manager",
    parentId: superAgent.id,
    model: "deepseek-chat",
    systemPrompt: "你是 KnowPilot 默认助手，可以调用 spawn_subagent / async_task_run / sleep / read_article / web_search 等工具完成任务。",
    tools: ["native:spawn_subagent", "native:async_task_run", "native:async_task_status", "native:async_task_wait", "native:async_task_cancel", "native:sleep", "native:read_article", "native:web_search"],
    source: "e2e-seed",
  });
  console.log("[e2e globalSetup] 已创建默认 manager Agent");
}

function spawnServer(serverPort) {
  const tsxCli = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`[e2e globalSetup] 找不到 tsx CLI: ${tsxCli}`);
  }

  const serverEnv = {
    ...process.env,
    SERVER_PORT: String(serverPort),
    DATABASE_URL: TEST_DB_URL,
    KP_CONTENT_DIR: TEST_CONTENT_DIR,
    REQUIRE_APPROVAL: process.env.REQUIRE_APPROVAL ?? "false",
  };
  for (const key of ["MOCK_LLM", "MOCK_MCP", "MOCK_NATIVE_TOOLS"]) {
    if (process.env[key]) serverEnv[key] = process.env[key];
  }

  const proc = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: serverDir,
    env: serverEnv,
    stdio: "pipe",
    windowsHide: true,
  });

  proc.stdout.on("data", (data) => {
    process.stdout.write(`[e2e server] ${data}`);
  });
  proc.stderr.on("data", (data) => {
    process.stderr.write(`[e2e server] ${data}`);
  });

  return proc;
}

function spawnWeb(webPort) {
  const nextBin = path.join(webDir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error(`[e2e globalSetup] 找不到 next CLI: ${nextBin}`);
  }

  const webEnv = {
    ...process.env,
    SERVER_INTERNAL_URL: process.env.SERVER_INTERNAL_URL ?? `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "3010"}`,
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL ?? `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "3010"}`,
    PORT: String(webPort),
  };

  const proc = spawn(process.execPath, [nextBin, "start", "-p", String(webPort)], {
    cwd: webDir,
    env: webEnv,
    stdio: "pipe",
    windowsHide: true,
  });

  proc.stdout.on("data", (data) => {
    process.stdout.write(`[e2e web] ${data}`);
  });
  proc.stderr.on("data", (data) => {
    process.stderr.write(`[e2e web] ${data}`);
  });

  return proc;
}

export default async function globalSetup() {
  const { serverPort, webPort } = getE2EPorts();

  // 1. 清理可能残留的 E2E server/web 进程
  killStaleTestProcesses();
  await sleep(500);

  // 2. 隔离数据库与 content 目录
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.KP_CONTENT_DIR = TEST_CONTENT_DIR;

  // 3. 删除旧测试库（带重试，防止残留进程占用）
  await removeDbFiles(path.join(serverDir, "prisma"), TEST_DB_NAME);

  // 4. 创建隔离 content 目录
  fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true });
  for (const sub of CONTENT_SUBDIRS) {
    fs.mkdirSync(path.join(TEST_CONTENT_DIR, sub), { recursive: true });
  }

  // 5. 复制 about profile（about.getProfile 依赖）
  const realProfile = path.join(projectRoot, "content", "about", "profile.md");
  const testProfile = path.join(TEST_CONTENT_DIR, "about", "profile.md");
  if (fs.existsSync(realProfile)) {
    fs.copyFileSync(realProfile, testProfile);
  } else {
    fs.writeFileSync(
      testProfile,
      "---\nname: Test User\n---\n\n# About\n\nE2E 测试环境占位 profile。\n",
    );
  }

  // 6. 同步 schema 到测试库
  const prismaCli = getPrismaCli();
  if (!prismaCli) {
    throw new Error("[e2e globalSetup] 找不到 prisma CLI 入口");
  }
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "db", "push", "--skip-generate", "--accept-data-loss"],
      {
        cwd: serverDir,
        env: { ...process.env, DATABASE_URL: TEST_DB_URL },
        stdio: "pipe",
      },
    );
  } catch (err) {
    console.error("[e2e globalSetup] prisma db push 失败:", err instanceof Error ? err.message : err);
    throw err;
  }

  // 7. 启动 E2E server（由 globalSetup 托管，避免 Playwright webServer 与 globalSetup 并行导致时序问题）
  const serverProc = spawnServer(serverPort);

  // 8. 启动 E2E web（等待 server 健康后再启动，避免请求打到未就绪后端）
  const webBuildDir = path.join(webDir, ".next");
  if (!fs.existsSync(webBuildDir)) {
    throw new Error(`[e2e globalSetup] 缺少 ${webBuildDir}，请先运行对应 build 命令（如 pnpm build:mock）`);
  }
  const webProc = spawnWeb(webPort);

  // 9. 等待 server 就绪，并预置一个 manager 级 Assistant Agent
  // （部分 mock E2E 依赖该 Agent 作为可调用 spawn_subagent 的对话主体）
  await waitForUrl(`http://127.0.0.1:${serverPort}/health`, 120_000);
  await seedAssistantManager(serverPort);

  // 10. 等待 web 就绪
  await waitForUrl(`http://127.0.0.1:${webPort}/`, 120_000);

  // 10. 记录 PID，供 teardown 精确清理
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify({ serverPid: serverProc.pid, webPid: webProc.pid, serverPort, webPort }, null, 2),
  );

  console.log(`[e2e globalSetup] server=http://127.0.0.1:${serverPort} web=http://127.0.0.1:${webPort} 已就绪`);
}
