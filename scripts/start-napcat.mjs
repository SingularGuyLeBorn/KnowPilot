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

  const httpServerConfig = {
    enable: true,
    name: "OasisMind OneBot API",
    host: "127.0.0.1",
    port: 3001,
    token: "",
    enableCors: true
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
        if (!Array.isArray(content.network.httpServers)) content.network.httpServers = [];

        // 配置 HTTP 反向 Webhook
        const webhookExists = content.network.httpClients.some((c) => c.url?.includes("/api/webhooks/onebot"));
        if (!webhookExists) {
          content.network.httpClients.push(webhookConfig);
        }

        // 配置 HTTP API 服务端 (端口 3001，避免 3000 Next.js 冲突)
        const serverExists = content.network.httpServers.some((s) => s.port === 3001);
        if (!serverExists) {
          content.network.httpServers.push(httpServerConfig);
        }

        fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), "utf8");
        console.log(`✅ 已自动配置并同步 OneBot 端口 (3001) 与 Webhook 到 ${f}`);
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
        httpServers: [httpServerConfig],
        httpSseServers: [],
        httpClients: [webhookConfig],
        websocketServers: [],
        websocketClients: [],
        plugins: []
      }
    };
    fs.writeFileSync(defaultPath, JSON.stringify(defaultData, null, 2), "utf8");
    console.log("✅ 已为您自动创建默认 onebot11.json (API: 3001, Webhook: 3010)");
  }
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信 (API 3001 ↔ Webhook 3010)...");
  configureNapCat();

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
