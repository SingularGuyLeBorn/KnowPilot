import crypto from "crypto";
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
const QQ_PASSWORD = (process.env.ONEBOT_QQ_PASSWORD || process.env.NAPCAT_QUICK_PASSWORD || "").trim();
const HTTP_URL = (process.env.ONEBOT_HTTP_URL || "http://127.0.0.1:3001").trim();
const QQ_EXE = (process.env.ONEBOT_QQ_EXE || "D:\\Program Files\\Tencent\\QQNT\\QQ.exe").trim();
const KILL_ON_MISMATCH = (process.env.ONEBOT_QQ_KILL_ON_MISMATCH || "false").trim().toLowerCase() !== "false";
const WEBHOOK_URL = (process.env.ONEBOT_WEBHOOK_URL || "http://localhost:3010/api/webhooks/onebot").trim();
const QQ_MULTI_OPEN = (process.env.ONEBOT_QQ_MULTI_OPEN || "false").trim().toLowerCase() !== "false";
const QQ_AUTO_OPEN = (process.env.ONEBOT_QQ_AUTO_OPEN || "true").trim().toLowerCase() !== "false";
const QQ_LOGIN_TIMEOUT_MS = Math.max(30000, parseInt(process.env.ONEBOT_QQ_LOGIN_TIMEOUT_MS || "120000", 10));
/** 登录成功后是否长驻监控掉线并自动重登（远程无人值守场景默认开） */
const QQ_WATCHDOG = (process.env.ONEBOT_QQ_WATCHDOG || "true").trim().toLowerCase() !== "false";
const WATCHDOG_INTERVAL_MS = Math.max(10000, parseInt(process.env.ONEBOT_QQ_WATCHDOG_INTERVAL_MS || "30000", 10));
/** 两次硬重启最短间隔，避免风控连环踢 */
const RECOVER_MIN_INTERVAL_MS = Math.max(30000, parseInt(process.env.ONEBOT_QQ_RECOVER_MIN_INTERVAL_MS || "90000", 10));
const RECOVER_MAX_PER_HOUR = Math.max(1, parseInt(process.env.ONEBOT_QQ_RECOVER_MAX_PER_HOUR || "6", 10));
const WEBUI_URL = (process.env.ONEBOT_WEBUI_URL || "http://127.0.0.1:6099").trim().replace(/\/$/, "");
const WEBUI_TOKEN_ENV = (process.env.ONEBOT_WEBUI_TOKEN || process.env.NAPCAT_WEBUI_SECRET_KEY || "").trim();

const napcatRoot = path.resolve(projectRoot, "tools/napcat_framework");
const configDir = path.join(napcatRoot, "config");
const webuiConfigPath = path.join(configDir, "webui.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import('child_process').ChildProcess | null} */
let napcatChild = null;
/** @type {string | null} */
let webuiCredential = null;
let webuiCredentialAt = 0;
const recoverTimestamps = [];
let recovering = false;
let logReadOffset = 0;
const LOG_PATH = path.join(napcatRoot, "napcat.log");
const NEED_HUMAN_PATH = path.join(napcatRoot, "NEED_HUMAN_LOGIN.txt");
/** 日志踢线扫描间隔（对齐 NapCat WebUI 约 5s 轮询 online） */
const LOG_SCAN_INTERVAL_MS = Math.max(3000, parseInt(process.env.ONEBOT_QQ_LOG_SCAN_INTERVAL_MS || "5000", 10));

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

function readWebUiToken() {
  if (WEBUI_TOKEN_ENV) return WEBUI_TOKEN_ENV;
  try {
    if (!fs.existsSync(webuiConfigPath)) return "";
    const parsed = JSON.parse(fs.readFileSync(webuiConfigPath, "utf8"));
    return String(parsed.token || "").trim();
  } catch {
    return "";
  }
}

/** 写入 WebUI 自动登录账号；可选固定 token，便于脚本调 WebUI API 重登 */
function configureWebUiAutoLogin() {
  if (!QQ_ACCOUNT) return;
  let data = {
    host: "::",
    port: 6099,
    token: WEBUI_TOKEN_ENV || crypto.randomBytes(6).toString("hex"),
    loginRate: 10,
    autoLoginAccount: QQ_ACCOUNT,
  };
  if (fs.existsSync(webuiConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(webuiConfigPath, "utf8"));
      data = { ...parsed, autoLoginAccount: QQ_ACCOUNT };
      if (WEBUI_TOKEN_ENV) data.token = WEBUI_TOKEN_ENV;
      if (!data.token) data.token = crypto.randomBytes(6).toString("hex");
    } catch {
      /* 用默认骨架 */
    }
  }
  fs.writeFileSync(webuiConfigPath, JSON.stringify(data, null, 4), "utf8");
  console.log(`✅ 已写入 WebUI autoLoginAccount=${QQ_ACCOUNT}（快速登录优先，密码回退）`);
}

function configureNapCat() {
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
    console.log(
      `✅ 已生成单账号配置 onebot11_${QQ_ACCOUNT}.json (API ${httpServerConfig.host}:${httpServerConfig.port} ↔ Webhook ${WEBHOOK_URL})`,
    );

    const files = fs.readdirSync(configDir);
    for (const f of files) {
      if (f.startsWith("onebot11_") && f.endsWith(".json") && f !== `onebot11_${QQ_ACCOUNT}.json`) {
        fs.rmSync(path.join(configDir, f), { force: true });
        console.log(`🧹 已清理非目标账号配置 ${f}`);
      }
    }
  } else {
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
      } catch {
        /* ignore */
      }
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

  configureWebUiAutoLogin();
}

async function fetchLoginInfo(timeoutMs = 3000) {
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

/** OneBot get_status：部分适配器在假在线时 login_info 仍通，online=false 才是真掉线 */
async function fetchOneBotOnline(timeoutMs = 3000) {
  const url = `${HTTP_URL.replace(/\/$/, "")}/get_status`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, online: null };
    const data = await res.json();
    const online = data?.data?.online;
    if (typeof online === "boolean") return { ok: true, online };
    return { ok: true, online: null };
  } catch {
    return { ok: false, online: null };
  }
}

function isTargetOnline(info) {
  return Boolean(QQ_ACCOUNT && info.selfId === QQ_ACCOUNT);
}

function webUiUrlHint() {
  const token = readWebUiToken();
  return token ? `${WEBUI_URL}/webui/?token=${encodeURIComponent(token)}` : `${WEBUI_URL}/webui/`;
}

function writeNeedHuman(reason, detail = "") {
  const body = [
    `reason=${reason}`,
    `account=${QQ_ACCOUNT}`,
    `at=${new Date().toISOString()}`,
    `webui=${webUiUrlHint()}`,
    detail ? `detail=${detail}` : "",
    "",
    "完成一次人工验证（验证码/新设备扫码）后删除本文件；守护进程会继续自动重登。",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    fs.writeFileSync(NEED_HUMAN_PATH, body, "utf8");
  } catch {
    /* ignore */
  }
  console.error(`🚨 需要人工介入：${reason}`);
  console.error(`   WebUI: ${webUiUrlHint()}`);
  console.error(`   标记文件: ${NEED_HUMAN_PATH}`);
}

function clearNeedHuman() {
  try {
    if (fs.existsSync(NEED_HUMAN_PATH)) fs.rmSync(NEED_HUMAN_PATH, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * 社区成熟探测：多信号交叉验证（对齐 NapCat WebUI 每 5s 看 online + CheckLoginStatus）。
 * @returns {Promise<{ online: boolean, reason: string, signals: Record<string, unknown> }>}
 */
async function probeHealth() {
  const signals = {};
  const info = await fetchLoginInfo(3500);
  signals.loginInfo = info.selfId || null;
  signals.loginInfoReachable = info.viaOneBot;

  const status = await fetchOneBotOnline(3500);
  signals.oneBotOnline = status.online;

  let webUiOnline = null;
  let webUiIsLogin = null;
  let webUiIsOffline = null;
  try {
    const webUiUp = await waitForWebUi(3000);
    if (webUiUp) {
      const loginInfo = await webUiPost("/QQLogin/GetQQLoginInfo", {});
      if (loginInfo.ok) {
        webUiOnline = loginInfo.data?.data?.online;
        signals.webUiOnline = webUiOnline;
      }
      const st = await webUiPost("/QQLogin/CheckLoginStatus", {});
      if (st.ok || st.data?.data) {
        webUiIsLogin = st.data?.data?.isLogin;
        webUiIsOffline = st.data?.data?.isOffline;
        signals.webUiIsLogin = webUiIsLogin;
        signals.webUiIsOffline = webUiIsOffline;
      }
    }
  } catch {
    signals.webUiError = true;
  }

  const targetOk = isTargetOnline(info);
  if (targetOk && status.online === false) {
    return { online: false, reason: "onebot-status-offline", signals };
  }
  if (targetOk && webUiOnline === false) {
    return { online: false, reason: "webui-online-false", signals };
  }
  if (targetOk && webUiIsOffline === true) {
    return { online: false, reason: "webui-isOffline", signals };
  }
  if (targetOk) {
    return { online: true, reason: "ok", signals };
  }
  if (info.selfId && info.selfId !== QQ_ACCOUNT) {
    return { online: false, reason: `wrong-account:${info.selfId}`, signals };
  }
  return { online: false, reason: "login-info-miss", signals };
}

/** 扫 napcat.log 增量，秒级捕获 KickedOffLine（比纯轮询更贴社区排障习惯） */
function scanNapCatLogForKick() {
  try {
    if (!fs.existsSync(LOG_PATH)) return null;
    const stat = fs.statSync(LOG_PATH);
    if (stat.size < logReadOffset) logReadOffset = 0; // 日志轮转
    if (stat.size === logReadOffset) return null;
    const start = Math.max(logReadOffset, Math.max(0, stat.size - 256_000));
    const fd = fs.openSync(LOG_PATH, "r");
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    logReadOffset = stat.size;
    const text = buf.toString("utf8");
    const patterns = [
      /\[KickedOffLine\]/,
      /登录已失效/,
      /账号状态变更为离线/,
      /帐号当前登录已失效/,
    ];
    for (const re of patterns) {
      if (re.test(text)) {
        const lines = text.split(/\r?\n/).filter((l) => patterns.some((p) => p.test(l)));
        return lines[lines.length - 1] || "KickedOffLine";
      }
    }
  } catch {
    /* ignore */
  }
  return null;
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
  } catch {
    /* ignore */
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  console.log(`🧹 关闭本次启动的进程树 (PID ${pid})…`);
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

function passwordMd5() {
  if (!QQ_PASSWORD) return "";
  return crypto.createHash("md5").update(QQ_PASSWORD, "utf8").digest("hex");
}

function webUiPasswordHash(token) {
  return crypto.createHash("sha256").update(`${token}.napcat`).digest("hex");
}

async function ensureWebUiCredential(force = false) {
  const token = readWebUiToken();
  if (!token) throw new Error("WebUI token 不可用（检查 tools/napcat_framework/config/webui.json）");

  const fresh = webuiCredential && Date.now() - webuiCredentialAt < 45 * 60 * 1000;
  if (!force && fresh) return webuiCredential;

  const hash = webUiPasswordHash(token);
  const res = await fetch(`${WEBUI_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`WebUI 登录 HTTP ${res.status}`);
  const data = await res.json();
  const credential = data?.data?.Credential;
  if (!credential) throw new Error(data?.message || "WebUI 登录未返回 Credential");
  webuiCredential = credential;
  webuiCredentialAt = Date.now();
  return credential;
}

async function webUiPost(apiPath, body = {}) {
  const tryOnce = async (forceAuth) => {
    const credential = await ensureWebUiCredential(forceAuth);
    const res = await fetch(`${WEBUI_URL}/api${apiPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 200) };
    }
    return { res, data };
  };

  let { res, data } = await tryOnce(false);
  if (res.status === 401 || String(data?.message || "").toLowerCase().includes("unauthorized")) {
    ({ res, data } = await tryOnce(true));
  }
  // NapCat sendError 也回 HTTP 200，业务成败看 code（0=成功，-1=失败）
  const code = data?.code;
  const ok = res.ok && (code === undefined || code === 0);
  return { ok, status: res.status, data, code };
}

async function waitForWebUi(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${WEBUI_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: "probe" }),
        signal: AbortSignal.timeout(2000),
      });
      // 任意 HTTP 响应都说明 WebUI 已起来（探针 hash 会 4xx，属正常）
      if (res.status > 0) return true;
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  return false;
}

/**
 * 通过 NapCat WebUI 尝试无人值守重登：
 * 1) 快速登录（本地 session）
 * 2) 密码登录回退（ONEBOT_QQ_PASSWORD / NAPCAT_QUICK_PASSWORD）
 */
async function tryAutoLoginViaWebUi() {
  if (!QQ_ACCOUNT) return { ok: false, reason: "no-account" };

  const webUiUp = await waitForWebUi(20000);
  if (!webUiUp) return { ok: false, reason: "webui-down" };

  // 持久化自动登录账号（与 webui.json 双写）
  try {
    await webUiPost("/QQLogin/SetQuickLoginQQ", { uin: QQ_ACCOUNT });
  } catch {
    /* 非致命 */
  }

  const status = await webUiPost("/QQLogin/CheckLoginStatus", {});
  if (status.data?.data?.isLogin) {
    const info = await fetchLoginInfo(3000);
    if (isTargetOnline(info)) return { ok: true, reason: "already-login" };
    // WebUI 以为已登录但 OneBot 不通（常见于 KickedOffLine 后状态未刷），继续走快速/密码
    console.log("ℹ️  WebUI 报已登录，但 OneBot 未确认目标账号，继续尝试重登…");
  }

  console.log(`🔑 尝试 WebUI 快速登录 ${QQ_ACCOUNT}…`);
  const quick = await webUiPost("/QQLogin/SetQuickLogin", { uin: QQ_ACCOUNT });
  if (quick.ok) {
    for (let i = 0; i < 20; i++) {
      const health = await probeHealth();
      if (health.online) {
        clearNeedHuman();
        return { ok: true, reason: "quick-login" };
      }
      await sleep(1500);
    }
  } else {
    const msg = String(quick.data?.message || quick.data?.msg || `HTTP ${quick.status}`);
    // NapCat #1818：踢线后 WebUI 仍报已登录，挡快速登录——交给上层 Process/Restart
    console.log(`⚠️  快速登录未成功：${msg}`);
    if (/logined|已登录/i.test(msg)) {
      return { ok: false, reason: "stale-login-status" };
    }
  }

  const md5 = passwordMd5();
  if (!md5) {
    writeNeedHuman("need-password-or-scan", "未配置 ONEBOT_QQ_PASSWORD，且快速登录失败");
    return { ok: false, reason: "need-password-or-scan" };
  }

  console.log(`🔑 快速登录失败，尝试密码回退登录（社区 #1632 推荐降级；不打印密码）…`);
  const pwd = await webUiPost("/QQLogin/PasswordLogin", { uin: QQ_ACCOUNT, passwordMd5: md5 });
  const payload = pwd.data?.data || {};
  if (payload.needCaptcha) {
    writeNeedHuman("need-captcha", "密码登录需要验证码");
    return { ok: false, reason: "need-captcha" };
  }
  if (payload.needNewDevice) {
    writeNeedHuman("need-new-device", "密码登录需要新设备扫码");
    return { ok: false, reason: "need-new-device" };
  }
  if (!pwd.ok) {
    const msg = pwd.data?.message || pwd.data?.msg || `HTTP ${pwd.status}`;
    console.log(`⚠️  密码登录失败：${msg}`);
    if (/logined|已登录/i.test(String(msg))) {
      return { ok: false, reason: "stale-login-status" };
    }
    return { ok: false, reason: "password-failed" };
  }

  for (let i = 0; i < 30; i++) {
    const health = await probeHealth();
    if (health.online) {
      clearNeedHuman();
      return { ok: true, reason: "password-login" };
    }
    await sleep(1500);
  }
  return { ok: false, reason: "login-timeout-after-password" };
}

/** NapCat WebUI 官方掉线恢复：Process/Restart（比 taskkill 更轻，保留 QQ 数据目录） */
async function softRestartViaWebUi() {
  console.log("🔄 尝试 NapCat WebUI 软重启（/Process/Restart → /QQLogin/RestartNapCat）…");
  webuiCredential = null;
  let ok = false;
  try {
    const r1 = await webUiPost("/Process/Restart", {});
    ok = r1.ok;
    if (!ok) {
      const r2 = await webUiPost("/QQLogin/RestartNapCat", {});
      ok = r2.ok;
    }
  } catch (err) {
    console.log(`ℹ️  软重启 API 调用异常：${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!ok) {
    console.log("ℹ️  WebUI 软重启未确认成功");
    return false;
  }
  console.log("⏳ 等待 NapCat 软重启后 WebUI / OneBot 恢复…");
  await sleep(5000);
  const up = await waitForWebUi(90000);
  if (!up) return false;
  // 软重启后重新走快速/密码（env 仍在原进程时可能丢失；硬重启才带 env——此处靠 webui.json autoLogin + 我们主动调）
  const login = await tryAutoLoginViaWebUi();
  if (login.ok) {
    const health = await probeHealth();
    return health.online;
  }
  // 再等一轮探测（有时登录异步完成）
  for (let i = 0; i < 20; i++) {
    const health = await probeHealth();
    if (health.online) return true;
    await sleep(1500);
  }
  return false;
}

function canHardRestart() {
  const now = Date.now();
  while (recoverTimestamps.length && now - recoverTimestamps[0] > 3600_000) {
    recoverTimestamps.shift();
  }
  if (recoverTimestamps.length >= RECOVER_MAX_PER_HOUR) {
    return false;
  }
  const last = recoverTimestamps[recoverTimestamps.length - 1] || 0;
  return now - last >= RECOVER_MIN_INTERVAL_MS;
}

function markHardRestart() {
  recoverTimestamps.push(Date.now());
}

function spawnNapCat() {
  if (!fs.existsSync(QQ_EXE)) {
    throw new Error(`QQ 可执行文件不存在：${QQ_EXE}，请设 ONEBOT_QQ_EXE`);
  }

  const dllPath = path.join(napcatRoot, "napiloader.dll");
  const cjsPath = path.join(napcatRoot, "nativeLoader.cjs");
  const exePath = path.join(napcatRoot, "napimain.exe");

  if (!fs.existsSync(exePath)) {
    throw new Error(`NapCat 启动器不存在：${exePath}`);
  }

  console.log("🚀 启动 NapCat Framework 守护引擎…");

  const logFile = path.join(napcatRoot, "napcat.log");
  const outFd = fs.openSync(logFile, "a");

  const childEnv = {
    ...process.env,
    NAPCAT_QUICK_ACCOUNT: QQ_ACCOUNT || process.env.NAPCAT_QUICK_ACCOUNT || "",
  };
  if (QQ_PASSWORD) {
    childEnv.NAPCAT_QUICK_PASSWORD = QQ_PASSWORD;
  }
  const webuiToken = readWebUiToken();
  if (webuiToken) {
    childEnv.NAPCAT_WEBUI_SECRET_KEY = webuiToken;
  }

  const child = spawn(exePath, [QQ_EXE, dllPath, cjsPath], {
    cwd: napcatRoot,
    stdio: ["ignore", outFd, outFd],
    detached: true,
    env: childEnv,
  });
  child.unref();
  napcatChild = child;
  return child;
}

async function pollSelfId(timeoutMs = QQ_LOGIN_TIMEOUT_MS) {
  if (!QQ_ACCOUNT) return { ok: true, selfId: null };
  const start = Date.now();
  let lastNotify = 0;
  let lastSelfId = null;
  let nextAutoLoginAt = start + 8000;
  console.log(`🔍 校验 NapCat 登录账号是否为目标 ${QQ_ACCOUNT}…`);
  console.log(
    `⏳ 等待登录 ${QQ_ACCOUNT}（${timeoutMs / 1000}s）：优先自动快速/密码登录；若需验证码请打开 WebUI`,
  );
  while (Date.now() - start < timeoutMs) {
    const health = await probeHealth();
    if (health.online) {
      clearNeedHuman();
      console.log(`✅ 登录态检测成功：当前登录账号 ${QQ_ACCOUNT}`);
      return { ok: true, selfId: QQ_ACCOUNT };
    }
    if (health.signals.loginInfo && health.signals.loginInfo !== QQ_ACCOUNT) {
      if (health.signals.loginInfo !== lastSelfId) {
        console.log(
          `⚠️  检测到非目标账号 ${health.signals.loginInfo}，继续等待目标 ${QQ_ACCOUNT} 登录…`,
        );
        lastSelfId = health.signals.loginInfo;
        lastNotify = Date.now() - start;
      }
    }

    // 周期性重试自动登录（不仅一次）：应对 WebUI 晚就绪 / 首轮 stale-login-status
    if (Date.now() >= nextAutoLoginAt) {
      nextAutoLoginAt = Date.now() + 20000;
      try {
        const result = await tryAutoLoginViaWebUi();
        if (result.ok) {
          console.log(`✅ 自动登录成功（${result.reason}）`);
          clearNeedHuman();
          return { ok: true, selfId: QQ_ACCOUNT };
        }
        if (result.reason === "stale-login-status") {
          console.log("ℹ️  登录状态陈旧，尝试 WebUI 软重启后再登…");
          if (await softRestartViaWebUi()) {
            clearNeedHuman();
            return { ok: true, selfId: QQ_ACCOUNT };
          }
        }
        console.log(`ℹ️  自动登录暂未成功（${result.reason}），继续轮询…`);
      } catch (err) {
        console.log(`ℹ️  自动登录调用异常：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed - lastNotify >= 10000) {
      console.log(
        `⏳ 等待登录中… 已等待 ${Math.round(elapsed / 1000)}s / ${timeoutMs / 1000}s` +
          `（probe=${health.reason}）`,
      );
      lastNotify = elapsed;
    }
    await sleep(1500);
  }
  if (lastSelfId) {
    console.error(
      `❌ 登录超时：在 ${timeoutMs / 1000}s 内未检测到目标账号 ${QQ_ACCOUNT}；` +
        `最后检测到账号 ${lastSelfId}。`,
    );
  } else {
    console.error(
      `❌ 登录超时：在 ${timeoutMs / 1000}s 内未确认目标账号在线；WebUI: ${webUiUrlHint()}`,
    );
  }
  return { ok: false, selfId: lastSelfId };
}

async function hardRestartNapCat(reason) {
  if (!canHardRestart()) {
    console.error(
      `⛔ 硬重启节流：每小时最多 ${RECOVER_MAX_PER_HOUR} 次、间隔 ≥ ${RECOVER_MIN_INTERVAL_MS / 1000}s。原因：${reason}`,
    );
    return false;
  }
  markHardRestart();
  console.log(`♻️  硬重启 NapCat/QQ（${reason}）…`);
  if (napcatChild?.pid) {
    killProcessTree(napcatChild.pid);
  } else {
    killNapCatOnly();
    if (!QQ_MULTI_OPEN && isProcessRunning("QQ.exe")) {
      console.log("🧹 单账号模式：关闭残留 QQ.exe 以便干净重登…");
      try {
        execSync("taskkill /F /IM QQ.exe", { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  }
  napcatChild = null;
  webuiCredential = null;
  await sleep(2500);
  spawnNapCat();
  const { ok } = await pollSelfId(QQ_LOGIN_TIMEOUT_MS);
  if (ok) clearNeedHuman();
  return ok;
}

/**
 * 恢复阶梯（社区实践）：
 * L1 快速登录 → 密码回退
 * L2 WebUI Process/Restart（官方掉线弹窗同款）
 * L3 taskkill 硬重启（节流）
 */
async function recoverFromOffline(reason) {
  if (recovering) {
    console.log("ℹ️  已有恢复流程在进行，跳过并发恢复");
    return false;
  }
  recovering = true;
  console.log(`🔌 检测到掉线（${reason}），进入三级恢复…`);
  try {
    // L1
    try {
      const soft = await tryAutoLoginViaWebUi();
      if (soft.ok) {
        const health = await probeHealth();
        if (health.online) {
          console.log(`✅ L1 软重登成功（${soft.reason}）`);
          clearNeedHuman();
          return true;
        }
      } else if (soft.reason === "need-captcha" || soft.reason === "need-new-device") {
        // 人工门禁：不再连环硬重启加重风控
        console.error("⛔ 需要人工验证，本轮停止自动硬重启（避免风控连环踢）");
        return false;
      } else {
        console.log(`ℹ️  L1 失败（${soft.reason}）→ L2`);
      }
    } catch (err) {
      console.log(`ℹ️  L1 异常：${err instanceof Error ? err.message : String(err)} → L2`);
    }

    // L2
    try {
      if (await softRestartViaWebUi()) {
        console.log("✅ L2 WebUI 软重启 + 重登成功");
        clearNeedHuman();
        return true;
      }
      console.log("ℹ️  L2 失败 → L3 硬重启");
    } catch (err) {
      console.log(`ℹ️  L2 异常：${err instanceof Error ? err.message : String(err)} → L3`);
    }

    // L3
    return hardRestartNapCat(reason);
  } finally {
    recovering = false;
  }
}

async function runWatchdog() {
  // 从当前日志末尾开始扫，避免把历史 KickedOffLine 当新事件
  try {
    if (fs.existsSync(LOG_PATH)) logReadOffset = fs.statSync(LOG_PATH).size;
  } catch {
    logReadOffset = 0;
  }

  console.log(
    `\n🛡️  QQ 掉线守护（增强）：` +
      `\n   · 多信号探测：get_login_info + get_status + WebUI online/isOffline` +
      `\n   · 日志秒级踢线：每 ${LOG_SCAN_INTERVAL_MS / 1000}s 扫 napcat.log` +
      `\n   · 恢复阶梯：快速/密码 → Process/Restart → 硬重启（≤${RECOVER_MAX_PER_HOUR}/时）` +
      `\n   · 需人工时写：${NEED_HUMAN_PATH}`,
  );

  let consecutiveMiss = 0;
  let lastProbeAt = 0;

  for (;;) {
    await sleep(LOG_SCAN_INTERVAL_MS);

    // 1) 日志瞬时踢线 → 立即恢复（不必等下一轮完整 interval）
    const kickLine = scanNapCatLogForKick();
    if (kickLine && !recovering) {
      console.log(`⚡ 日志捕获踢线：${kickLine.slice(0, 160)}`);
      if (fs.existsSync(NEED_HUMAN_PATH)) {
        console.log("⏳ 已有人工验证标记，跳过本次自动恢复阶梯");
        consecutiveMiss += 1;
      } else {
        const recovered = await recoverFromOffline("log:KickedOffLine");
        consecutiveMiss = recovered ? 0 : consecutiveMiss + 1;
      }
      lastProbeAt = Date.now();
      continue;
    }

    // 2) 周期性多信号探测
    if (Date.now() - lastProbeAt < WATCHDOG_INTERVAL_MS) continue;
    lastProbeAt = Date.now();

    const health = await probeHealth();
    if (health.online) {
      if (consecutiveMiss > 0) {
        console.log(`✅ 目标 QQ ${QQ_ACCOUNT} 已恢复在线`);
      }
      consecutiveMiss = 0;
      clearNeedHuman();
      continue;
    }

    consecutiveMiss += 1;
    console.log(
      `⚠️  健康探测失败 #${consecutiveMiss}：${health.reason}` +
        ` signals=${JSON.stringify(health.signals)}`,
    );

    // 已写人工标记：降频只做 L1，避免验证码期间狂硬重启
    if (fs.existsSync(NEED_HUMAN_PATH)) {
      if (consecutiveMiss % 6 === 0) {
        console.log("⏳ 存在 NEED_HUMAN_LOGIN.txt，仅低频尝试快速/密码（请先完成 WebUI 验证）…");
        try {
          const soft = await tryAutoLoginViaWebUi();
          if (soft.ok && (await probeHealth()).online) {
            clearNeedHuman();
            consecutiveMiss = 0;
            console.log("✅ 人工验证后自动登录成功");
          }
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    // 连续两次再恢复，避免瞬时空窗；日志踢线已走快速路径
    if (consecutiveMiss < 2) continue;

    const recovered = await recoverFromOffline(health.reason);
    consecutiveMiss = recovered ? 0 : consecutiveMiss;
  }
}

async function main() {
  console.log("⚙️ 自动校验与配置 OneBot 闭环通信…");

  if (QQ_ACCOUNT) {
    console.log(
      `🤖 单账号模式：目标 QQ ${QQ_ACCOUNT}` +
        (QQ_PASSWORD ? "（已配置密码，支持掉线自动重登）" : "（未配置密码：仅快速登录/扫码）"),
    );
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
    if (QQ_WATCHDOG) {
      await runWatchdog();
    }
    return;
  }

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
    if (QQ_WATCHDOG && QQ_ACCOUNT) {
      await runWatchdog();
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
      if (QQ_WATCHDOG && QQ_ACCOUNT) {
        // 可能稍后用户手动登录目标号，或当前实例稍后可用
        await runWatchdog();
      }
      return;
    }
    console.log(
      `⚠️ 检测到 QQ.exe 已在运行${existingSelfId ? `（已登录 ${existingSelfId}）` : "（无法确认账号）"}，` +
        " ONEBOT_QQ_MULTI_OPEN=true，尝试多开一个新的 Bot 实例…",
    );
    console.log("   提示：NapCat 应注入到新启动的 QQ 实例；若附到已运行的 QQ 上，脚本会报错。");
  } else {
    killNapCatOnly();
    await sleep(1500);
  }

  const child = spawnNapCat();

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
      console.error(
        `❌ 在 ${QQ_LOGIN_TIMEOUT_MS / 1000}s 内未检测到 NapCat /get_login_info 返回；请检查 QQ 是否已登录。`,
      );
    }
    if (KILL_ON_MISMATCH) {
      console.log("⚠️ ONEBOT_QQ_KILL_ON_MISMATCH=true，关闭本次启动的 NapCat/QQ 进程树…");
      killProcessTree(child.pid);
    } else {
      console.log("⚠️ ONEBOT_QQ_KILL_ON_MISMATCH=false，保留已启动的 QQ 进程。");
    }
    // 即便首登失败，远程场景也进入守护，方便稍后扫一次码后自动接管
    if (QQ_WATCHDOG && QQ_ACCOUNT) {
      console.log("🛡️  首登未完成，仍进入掉线守护（完成一次人工验证后可自动续命）…");
      await runWatchdog();
      return;
    }
    process.exit(1);
  }

  console.log("\n🎉 【全自动闭环成功】NapCat HTTP API 已启用，Webhook 反向绑定！");
  if (QQ_WATCHDOG) {
    await runWatchdog();
  }
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
