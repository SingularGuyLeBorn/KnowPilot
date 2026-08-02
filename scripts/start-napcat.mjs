import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";

function configureNapCat() {
  const configDir = path.resolve("tools/napcat_framework/config");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const webhookConfig = {
    enable: true,
    name: "OasisMind Webhook",
    url: "http://localhost:3010/api/webhooks/onebot",
    token: "",
    secret: "",
    headers: {}
  };

  const httpServerConfig = {
    enable: true,
    name: "OasisMind OneBot API",
    host: "0.0.0.0",
    port: 3001,
    token: "",
    enableCors: true,
    enableWebsocket: false,
    messagePostFormat: "array"
  };

  // Always write/update the default fallback template onebot11.json
  const defaultPath = path.join(configDir, "onebot11.json");
  let defaultData = {
    network: {
      httpServers: [httpServerConfig],
      httpSseServers: [],
      httpClients: [webhookConfig],
      websocketServers: [],
      websocketClients: [],
      plugins: []
    }
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
  console.log("✅ 已自动同步模版 onebot11.json (API 3001 ↔ Webhook 3010)");

  // Scan and force enable on all specific account configs (onebot11_*.json)
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
        console.log(`✅ 已强制启用端口 (3001) 与 Webhook 到 ${f}`);
      } catch (e) {
        console.error(`解析 ${f} 失败:`, e);
      }
    }
  }
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信 (API 3001 ↔ Webhook 3010)...");
  configureNapCat();

  console.log("🧹 正在清理旧的 QQ / NapCat 进程...");
  try {
    execSync("taskkill /F /IM napimain.exe /IM QQ.exe", { stdio: "ignore" });
  } catch (e) {}

  // Wait 1.5 seconds for ports and locks to release
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const qqExe = "D:\\Program Files\\Tencent\\QQNT\\QQ.exe";
  const dllPath = path.resolve("tools/napcat_framework/napiloader.dll");
  const cjsPath = path.resolve("tools/napcat_framework/nativeLoader.cjs");
  const exePath = path.resolve("tools/napcat_framework/napimain.exe");

  console.log("🚀 重新启动 NapCat Framework 守护引擎...");

  const logFile = path.resolve("tools/napcat_framework/napcat.log");
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(exePath, [qqExe, dllPath, cjsPath], {
    cwd: path.resolve("tools/napcat_framework"),
    stdio: ["ignore", outFd, outFd],
    detached: true,
  });

  child.unref();
  console.log("\n🎉 【全自动闭环成功】NapCat HTTP API 已启用端口 3001，Webhook 反向绑定 3010！");
}

main().catch((err) => {
  console.error("启动失败:", err);
});

