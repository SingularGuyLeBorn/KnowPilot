import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/** 独立运行脚本时也需加载根目录 .env；已存在环境变量不覆盖。 */
function loadRootEnv() {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadRootEnv();

const QQ_ACCOUNT = (process.env.ONEBOT_QQ_ACCOUNT || "").trim();
const QQ_PASSWORD = (process.env.ONEBOT_QQ_PASSWORD || "").trim();
const HTTP_URL = (process.env.ONEBOT_HTTP_URL || "http://127.0.0.1:3001").trim();
const QQ_EXE = (process.env.ONEBOT_QQ_EXE || "D:\\Program Files\\Tencent\\QQNT\\QQ.exe").trim();
const KILL_ON_MISMATCH = (process.env.ONEBOT_QQ_KILL_ON_MISMATCH || "false").trim().toLowerCase() !== "false";
const WEBHOOK_URL = (process.env.ONEBOT_WEBHOOK_URL || "http://localhost:3010/api/webhooks/onebot").trim();
const QQ_MULTI_OPEN = (process.env.ONEBOT_QQ_MULTI_OPEN || "true").trim().toLowerCase() !== "false";
const QQ_AUTO_OPEN = (process.env.ONEBOT_QQ_AUTO_OPEN || "true").trim().toLowerCase() !== "false";
const QQ_LOGIN_TIMEOUT_MS = Math.max(30000, parseInt(process.env.ONEBOT_QQ_LOGIN_TIMEOUT_MS || "120000", 10));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getHttpConfig() {
  const url = new URL(HTTP_URL);
  return {
    enable: true,
    name: "OasisMind OneBot API",
    host: url.hostname === "127.0.0.1" || url.hostname === "localhost" ? "0.0.0.0" : url.hostname,
    port: Number(url.port) || 3001,
    token: "",
    enableCors: true,
    enableWebsocket: false,
    messagePostFormat: "array",
  };
}

function configureNapCat() {
  const configDir = path.resolve("tools/napcat_framework/config");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const webhookConfig = {
    enable: true,
    name: "OasisMind Webhook",
    url: WEBHOOK_URL,
    token: "",
    secret: "",
    headers: {},
  };

  const httpServerConfig = getHttpConfig();

  const baseNetwork = {
    httpServers: [httpServerConfig],
    httpSseServers: [],
    httpClients: [webhookConfig],
    websocketServers: [],
    websocketClients: [],
    plugins: [],
  };

  if (QQ_ACCOUNT) {
    // 单账号模式：只为指定账号生成配置，并清理其他 onebot11_*.json，避免启动错号
    const accountPath = path.join(configDir, `onebot11_${QQ_ACCOUNT}.json`);
    const accountConfig = {
      network: baseNetwork,
      musicSignUrl: "",
      enableLocalFile2Url: false,
      parseMultMsg: false,
      imageDownloadProxy: "",
      timeout: {
        baseTimeout: 10000,
        uploadSpeedKBps: 256,
        downloadSpeedKBps: 256,
        maxTimeout: 1800000,
      },
    };
    fs.writeFileSync(accountPath, JSON.stringify(accountConfig, null, 2), "utf8");
    console.log(`✅ 已生成单账号配置 onebot11_${QQ_ACCOUNT}.json (API ${httpServerConfig.host}:${httpServerConfig.port} ↔ Webhook ${WEBHOOK_URL})`);

    // 清理其他账号的 onebot11_*.json，防止 NapCat 加载到非目标账号
    const files = fs.readdirSync(configDir);
    for (const f of files) {
      if (f.startsWith("onebot11_") && f.endsWith(".json") && f !== `onebot11_${QQ_ACCOUNT}.json`) {
        fs.rmSync(path.join(configDir, f), { force: true });
        console.log(`🧹 已清理非目标账号配置 ${f}`);
      }
    }
  } else {
    // 兼容模式：不指定账号，保留原有全量配置行为
    const defaultPath = path.join(configDir, "onebot11.json");
    let defaultData = {
      network: baseNetwork,
      musicSignUrl: "",
      enableLocalFile2Url: false,
      parseMultMsg: false,
      imageDownloadProxy: "",
      timeout: {
        baseTimeout: 10000,
        uploadSpeedKBps: 256,
        downloadSpeedKBps: 256,
        maxTimeout: 1800000,
      },
    };

    if (fs.existsSync(defaultPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
        if (!parsed.network) parsed.network = {};
        parsed.network.httpServers = [httpServerConfig];
        parsed.network.httpClients = [webhookConfig];
        defaultData = parsed;
      } catch (e) {}
    }
    fs.writeFileSync(defaultPath, JSON.stringify(defaultData, null, 2), "utf8");
    console.log("✅ 已自动同步模版 onebot11.json");

    const files = fs.readdirSync(configDir);
    for (const f of files) {
      if (f.startsWith("onebot11_") && f.endsWith(".json")) {
        const fullPath = path.join(configDir, f);
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
          if (!content.network) content.network = {};
          content.network.httpServers = [httpServerConfig];
          content.network.httpClients = [webhookConfig];
          fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), "utf8");
          console.log(`✅ 已强制启用端口与 Webhook 到 ${f}`);
        } catch (e) {
          console.error(`解析 ${f} 失败:`, e);
        }
      }
    }
  }
}

async function fetchLoginInfo(timeoutMs = 3000) {
  if (!QQ_ACCOUNT) return { selfId: null, viaOneBot: false };
  const url = `${HTTP_URL.replace(/\/$/, "")}/get_login_info`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const selfId = String(data.data?.user_id ?? data.data?.self_id ?? "");
    return selfId ? { selfId, viaOneBot: true } : { selfId: null, viaOneBot: true };
  } catch {
    return { selfId: null, viaOneBot: false };
  }
}

function isProcessRunning(imageName) {
  try {
    const stdout = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, { stdio: ["pipe", "pipe", "ignore"] });
    return String(stdout).toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false;
  }
}

function killNapCatOnly() {
  console.log("🧹 清理旧 NapCat 进程…");
  try {
    execSync("taskkill /F /IM napimain.exe", { stdio: "ignore" });
  } catch {}
}

function killProcessTree(pid) {
  if (!pid) return;
  console.log(`🧹 关闭本次启动的进程树 (PID ${pid})…`);
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } catch {}
}

function killBotQQ() {
  console.log("🧹 关闭本次启动的 QQ/NapCat 进程…");
  try {
    execSync("taskkill /F /IM napimain.exe", { stdio: "ignore" });
  } catch {}
  try {
    execSync("taskkill /F /IM QQ.exe", { stdio: "ignore" });
  } catch {}
}

async function pollSelfId(timeoutMs = QQ_LOGIN_TIMEOUT_MS) {
  if (!QQ_ACCOUNT) return { ok: true, selfId: null };
  const start = Date.now();
  let lastNotify = 0;
  let lastSelfId = null;
  console.log(`🔍 校验 NapCat 登录账号是否为目标 ${QQ_ACCOUNT}…`);
  console.log(`⏳ 已打开 QQ 登录窗口，请登录 ${QQ_ACCOUNT}；脚本将等待 ${timeoutMs / 1000}s 检测登录态…`);
  while (Date.now() - start < timeoutMs) {
    const info = await fetchLoginInfo(3000);
    if (info.selfId) {
      if (info.selfId === QQ_ACCOUNT) {
        console.log(`✅ 登录态检测成功：当前登录账号 ${info.selfId}`);
        return { ok: true, selfId: info.selfId };
      }
      if (info.selfId !== lastSelfId) {
        console.log(
          `⚠️  检测到非目标账号 ${info.selfId}，继续等待目标 ${QQ_ACCOUNT} 登录…` +
            "（若长时间未变，请检查 NapCat 是否注入到新 QQ 窗口）",
        );
        lastSelfId = info.selfId;
        lastNotify = Date.now() - start;
      }
    }
    const elapsed = Date.now() - start;
    if (elapsed - lastNotify >= 10000) {
      console.log(`⏳ 等待登录中… 已等待 ${Math.round(elapsed / 1000)}s / ${timeoutMs / 1000}s`);
      lastNotify = elapsed;
    }
    await sleep(1500);
  }
  if (lastSelfId) {
    console.error(
      `❌ 登录超时：在 ${timeoutMs / 1000}s 内未检测到目标账号 ${QQ_ACCOUNT}；` +
        `最后检测到账号 ${lastSelfId}。请检查 NapCat 是否注入到新 QQ 窗口。`,
    );
  } else {
    console.error(`❌ 登录超时：在 ${timeoutMs / 1000}s 内未检测到 NapCat /get_login_info 返回；请检查 QQ 是否已登录。`);
  }
  return { ok: false, selfId: lastSelfId };
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信…");

  if (QQ_ACCOUNT) {
    console.log(`🤖 单账号模式：目标 QQ ${QQ_ACCOUNT}（密码已写入 .env，不打印）`);
  } else {
    console.log("🤖 兼容模式：未配置 ONEBOT_QQ_ACCOUNT，保留多账号配置");
  }

  if (!QQ_AUTO_OPEN) {
    console.log("🔕 ONEBOT_QQ_AUTO_OPEN=false，不主动打开 QQ/NapCat 新实例。");
  }

  configureNapCat();

  // 先检查是否已经有目标账号的 NapCat 在线，避免重复启动
  const existing = await fetchLoginInfo(3000);
  if (QQ_ACCOUNT && existing.selfId === QQ_ACCOUNT) {
    console.log(`✅ 检测到目标 QQ ${QQ_ACCOUNT} 已在线，无需重复启动。`);
    return;
  }

  // 记录已运行 QQ 的 self_id（可能是用户个人 QQ 也装了 NapCat），后面用来判断 NapCat 是否附错实例
  const existingSelfId = existing.selfId;
  if (existingSelfId) {
    console.log(`ℹ️ 检测到已有一个 QQ 实例在线：${existingSelfId}（不会关闭它）。`);
  }

  if (!QQ_AUTO_OPEN) {
    if (existingSelfId) {
      console.log(`ℹ️ 当前已有 QQ 在线：${existingSelfId}，自动打开已关闭，不执行多开。`);
    } else {
      console.log("⚠️ 未检测到任何 QQ 在线，且自动打开已关闭。请手动启动 NapCat/QQ 后重试。");
    }
    return;
  }

  const qqRunning = isProcessRunning("QQ.exe");

  if (qqRunning) {
    if (!QQ_MULTI_OPEN) {
      console.log(
        `⚠️ 检测到 QQ.exe 正在运行${existingSelfId ? `（已登录 ${existingSelfId}）` : "（无法确认账号）"}。` +
          " ONEBOT_QQ_MULTI_OPEN=false，未启动新实例。",
      );
      return;
    }
    console.log(
      `⚠️ 检测到 QQ.exe 已在运行${existingSelfId ? `（已登录 ${existingSelfId}）` : "（无法确认账号）"}，` +
        " ONEBOT_QQ_MULTI_OPEN=true，尝试多开一个新的 Bot 实例…",
    );
    console.log("   提示：NapCat 应注入到新启动的 QQ 实例；若附到已运行的 QQ 上，脚本会报错。");
  } else {
    // 没有 QQ 在跑时，清理旧 NapCat 进程安全
    killNapCatOnly();
    await sleep(1500);
  }

  if (!fs.existsSync(QQ_EXE)) {
    console.error(`❌ QQ 可执行文件不存在：${QQ_EXE}，请设 ONEBOT_QQ_EXE`);
    process.exit(1);
  }

  const dllPath = path.resolve("tools/napcat_framework/napiloader.dll");
  const cjsPath = path.resolve("tools/napcat_framework/nativeLoader.cjs");
  const exePath = path.resolve("tools/napcat_framework/napimain.exe");

  if (!fs.existsSync(exePath)) {
    console.error(`❌ NapCat 启动器不存在：${exePath}`);
    process.exit(1);
  }

  console.log("🚀 启动 NapCat Framework 守护引擎…");

  const logFile = path.resolve("tools/napcat_framework/napcat.log");
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(exePath, [QQ_EXE, dllPath, cjsPath], {
    cwd: path.resolve("tools/napcat_framework"),
    stdio: ["ignore", outFd, outFd],
    detached: true,
  });

  child.unref();

  const { ok, selfId } = await pollSelfId();
  if (!ok) {
    if (selfId && selfId === existingSelfId) {
      console.error(
        "❌ 校验失败：NapCat 附加到了已运行的 QQ 实例上，而非新启动的 Bot 实例。" +
          " 请关闭该 QQ 后重试，或检查 NapCat 多开注入逻辑。",
      );
    } else if (selfId) {
      console.error(`❌ 账号不匹配：当前登录为 ${selfId}，但配置要求 ${QQ_ACCOUNT}。`);
    } else {
      console.error(`❌ 在 ${QQ_LOGIN_TIMEOUT_MS / 1000}s 内未检测到 NapCat /get_login_info 返回；请检查 QQ 是否已登录。`);
    }
    if (KILL_ON_MISMATCH) {
      console.log("⚠️ ONEBOT_QQ_KILL_ON_MISMATCH=true，关闭本次启动的 NapCat/QQ 进程树…");
      killProcessTree(child.pid);
    } else {
      console.log("⚠️ ONEBOT_QQ_KILL_ON_MISMATCH=false，保留已启动的 QQ 进程。");
    }
    process.exit(1);
  }

  console.log("\n🎉 【全自动闭环成功】NapCat HTTP API 已启用，Webhook 反向绑定！");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
