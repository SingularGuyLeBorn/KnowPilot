import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";

const QQ_ACCOUNT = (process.env.ONEBOT_QQ_ACCOUNT || "").trim();
const QQ_PASSWORD = (process.env.ONEBOT_QQ_PASSWORD || "").trim();
const HTTP_URL = (process.env.ONEBOT_HTTP_URL || "http://127.0.0.1:3001").trim();
const QQ_EXE = (process.env.ONEBOT_QQ_EXE || "D:\\Program Files\\Tencent\\QQNT\\QQ.exe").trim();

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

async function pollSelfId(timeoutMs = 60_000) {
  if (!QQ_ACCOUNT) return true;
  const start = Date.now();
  const url = `${HTTP_URL.replace(/\/$/, "")}/get_login_info`;
  console.log(`🔍 校验 NapCat 登录账号是否为目标 ${QQ_ACCOUNT}…`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const selfId = String(data.data?.user_id ?? data.data?.self_id ?? "");
      if (selfId === QQ_ACCOUNT) {
        console.log(`✅ 校验通过：当前登录账号 ${selfId}`);
        return true;
      }
      if (selfId) {
        console.error(`❌ 账号不匹配：NapCat 当前登录为 ${selfId}，但配置要求 ${QQ_ACCOUNT}。请退出该 QQ 或清空 QQ 登录状态后重试。`);
        return false;
      }
    } catch {
      /* 尚未就绪，继续等待 */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  console.error(`❌ 在 ${timeoutMs / 1000}s 内未检测到 NapCat /get_login_info 返回；请检查 QQ 是否已登录。`);
  return false;
}

function killOldProcesses() {
  console.log("🧹 正在清理旧的 QQ / NapCat 进程…");
  try {
    execSync("taskkill /F /IM napimain.exe /IM QQ.exe", { stdio: "ignore" });
  } catch (e) {}
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信…");

  if (QQ_ACCOUNT) {
    console.log(`🤖 单账号模式：强制登录 QQ ${QQ_ACCOUNT}（密码已写入 .env，不打印）`);
  } else {
    console.log("🤖 兼容模式：未配置 ONEBOT_QQ_ACCOUNT，保留多账号配置");
  }

  configureNapCat();
  killOldProcesses();

  // 等待端口和锁释放
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

  console.log("🚀 重新启动 NapCat Framework 守护引擎…");

  const logFile = path.resolve("tools/napcat_framework/napcat.log");
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(exePath, [QQ_EXE, dllPath, cjsPath], {
    cwd: path.resolve("tools/napcat_framework"),
    stdio: ["ignore", outFd, outFd],
    detached: true,
  });

  child.unref();

  const ok = await pollSelfId();
  if (!ok) {
    // 校验失败：杀掉进程，避免错误账号一直在线
    try {
      execSync("taskkill /F /IM QQ.exe /IM napimain.exe", { stdio: "ignore" });
    } catch {}
    process.exit(1);
  }

  console.log("\n🎉 【全自动闭环成功】NapCat HTTP API 已启用，Webhook 反向绑定！");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
