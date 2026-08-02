import fs from "fs";
import path from "path";
import { spawn } from "child_process";

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

  const files = fs.readdirSync(configDir);
  let configuredCount = 0;

  for (const f of files) {
    if (f.startsWith("onebot11") && f.endsWith(".json")) {
      const fullPath = path.join(configDir, f);
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (!content.network) content.network = {};
        if (!Array.isArray(content.network.httpClients)) content.network.httpClients = [];

        const exists = content.network.httpClients.some((c) => c.url?.includes("/api/webhooks/onebot"));
        if (!exists) {
          content.network.httpClients.push(webhookConfig);
          fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), "utf8");
          console.log(`✅ 已自动为您配置 Webhook 到 ${f}`);
        } else {
          console.log(`ℹ️ ${f} 已包含 OasisMind Webhook 配置`);
        }
        configuredCount++;
      } catch (e) {
        console.error(`解析 ${f} 失败:`, e);
      }
    }
  }

  if (configuredCount === 0) {
    const defaultPath = path.join(configDir, "onebot11.json");
    const defaultData = {
      network: {
        httpServers: [],
        httpSseServers: [],
        httpClients: [webhookConfig],
        websocketServers: [],
        websocketClients: [],
        plugins: []
      }
    };
    fs.writeFileSync(defaultPath, JSON.stringify(defaultData, null, 2), "utf8");
    console.log("✅ 已为您自动创建默认 onebot11.json 并写入 OasisMind Webhook 端口");
  }
}

async function main() {
  console.log("⚙️ 自动校验并写入 OasisMind QQ Webhook 监听配置...");
  configureNapCat();

  const qqExe = "D:\\Program Files\\Tencent\\QQNT\\QQ.exe";
  const dllPath = path.resolve("tools/napcat_framework/napiloader.dll");
  const cjsPath = path.resolve("tools/napcat_framework/nativeLoader.cjs");
  const exePath = path.resolve("tools/napcat_framework/napimain.exe");

  console.log("🚀 启动 NapCat Framework 独立后台守护程序...");

  const logFile = path.resolve("tools/napcat_framework/napcat.log");
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(exePath, [qqExe, dllPath, cjsPath], {
    cwd: path.resolve("tools/napcat_framework"),
    stdio: ["ignore", outFd, outFd],
    detached: true,
  });

  child.unref();
  console.log("\n🎉 【全自动打通成功】NapCatQQ 守护服务已在后台持久化运行！");
  console.log("👉 已为您自动写入 Webhook 反向推送地址: http://localhost:3010/api/webhooks/onebot");
  console.log("👉 您无需手动操作任何网页配置，也不必打开任何控制台页面！");
}

main().catch((err) => {
  console.error("启动失败:", err);
});
