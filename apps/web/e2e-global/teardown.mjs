import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { TEST_DB_NAME, TEST_CONTENT_DIR, killStaleTestProcesses } from "./setup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "../../server");
const projectRoot = path.resolve(__dirname, "../../..");
const PID_FILE = path.join(projectRoot, ".test-e2e-pids.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killTree(pid) {
  if (!pid) return;
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

export default async function globalTeardown() {
  // 1. 精确清理 globalSetup 启动的进程
  let pids = { serverPid: null, webPid: null };
  try {
    if (fs.existsSync(PID_FILE)) {
      pids = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
      fs.rmSync(PID_FILE, { force: true });
    }
  } catch {
    /* ignore */
  }

  killTree(pids.serverPid);
  killTree(pids.webPid);
  await sleep(500);

  // 2. 兜底：按端口清理残留进程
  killStaleTestProcesses();
  await sleep(500);

  // 3. 删除测试数据库（带重试）
  for (let attempt = 0; attempt < 10; attempt++) {
    let failed = false;
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.rmSync(path.join(serverDir, "prisma", `${TEST_DB_NAME}${suffix}`), { force: true });
      } catch {
        failed = true;
      }
    }
    if (!failed) break;
    killStaleTestProcesses();
    await sleep(500);
  }

  // 4. 删除隔离 content 目录
  try {
    fs.rmSync(TEST_CONTENT_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
