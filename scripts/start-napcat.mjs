import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";

const QQ_ACCOUNT = (process.env.ONEBOT_QQ_ACCOUNT || "").trim();
const QQ_PASSWORD = (process.env.ONEBOT_QQ_PASSWORD || "").trim();
const HTTP_URL = (process.env.ONEBOT_HTTP_URL || "http://127.0.0.1:3001").trim();
const QQ_EXE = (process.env.ONEBOT_QQ_EXE || "D:\\Program Files\\Tencent\\QQNT\\QQ.exe").trim();
const KILL_ON_MISMATCH = (process.env.ONEBOT_QQ_KILL_ON_MISMATCH || "false").trim().toLowerCase() !== "false";
const WEBHOOK_URL = (process.env.ONEBOT_WEBHOOK_URL || "http://localhost:3010/api/webhooks/onebot").trim();

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

function killBotQQ() {
  console.log("🧹 关闭本次启动的 QQ/NapCat 进程…");
  try {
    execSync("taskkill /F /IM napimain.exe", { stdio: "ignore" });
  } catch {}
  try {
    execSync("taskkill /F /IM QQ.exe", { stdio: "ignore" });
  } catch {}
}

async function pollSelfId(timeoutMs = 60000) {
  if (!QQ_ACCOUNT) return { ok: true, selfId: null };
  const start = Date.now();
  console.log(`🔍 校验 NapCat 登录账号是否为目标 ${QQ_ACCOUNT}…`);
  while (Date.now() - start < timeoutMs) {
    const info = await fetchLoginInfo(3000);
    if (info.selfId) {
      if (info.selfId === QQ_ACCOUNT) {
        console.log(`✅ 校验通过：当前登录账号 ${info.selfId}`);
        return { ok: true, selfId: info.selfId };
      }
      console.error(`❌ 账号不匹配：当前登录为 ${info.selfId}，但配置要求 ${QQ_ACCOUNT}。`);
      return { ok: false, selfId: info.selfId };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  console.error(`❌ 在 ${timeoutMs / 1000}s 内未检测到 NapCat /get_login_info 返回；请检查 QQ 是否已登录。`);
  return { ok: false, selfId: null };
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信…");

  if (QQ_ACCOUNT) {
    console.log(`🤖 单账号模式：目标 QQ ${QQ_ACCOUNT}（密码已写入 .env，不打印）`);
  } else {
    console.log("🤖 兼容模式：未配置 ONEBOT_QQ_ACCOUNT，保留多账号配置");
  }

  configureNapCat();

  // 先检查是否已经有目标账号的 NapCat 在线，避免重复启动
  const existing = await fetchLoginInfo(3000);
  if (QQ_ACCOUNT && existing.selfId === QQ_ACCOUNT) {
    console.log(`✅ 检测到 QQ ${QQ_ACCOUNT} 已在线，无需重复启动。`);
    return;
  }

  // 若 QQ 已经在运行（可能是你常用的 2635495642），不强制杀，避免影响你正常使用
  if (isProcessRunning("QQ.exe")) {
    if (existing.selfId && QQ_ACCOUNT && existing.selfId !== QQ_ACCOUNT) {
      console.log(
        `⚠️ 检测到 QQ 已登录为 ${existing.selfId}（不是目标 ${QQ_ACCOUNT}）。` +
          " 为避免影响你正常使用，未强制关闭/切换。请手动切换/关闭该 QQ 后重试，" +
          "或设 ONEBOT_QQ_KILL_ON_MISMATCH=true 让脚本关闭本次错误登录的 QQ。",
      );
    } else {
      console.log(
        "⚠️ 检测到 QQ.exe 正在运行，但无法确认当前登录账号。" +
          " 为避免影响你正常使用，未强制关闭。请确保它是目标账号，或关闭后重试。",
      );
    }
    return;
  }

  // 没有 QQ 在运行，清理旧 NapCat 并启动新的
  killNapCatOnly();
  await new Promise((resolve) => setTimeout(resolve, 1500));

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
    // 我们启动的 QQ 登录了错误账号或超时：关闭它（不会误关你之前运行的 QQ）
    if (KILL_ON_MISMATCH) {
      killBotQQ();
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
