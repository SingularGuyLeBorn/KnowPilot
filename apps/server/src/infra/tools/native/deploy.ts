/**
 * Deploy 域 — pinme_upload：把静态站点一键发布到公网（PinMe / IPFS）。
 *
 * 为何不走 run_shell：
 * - shellRunner 会剥离 *API_KEY* / *SECRET* 等环境变量，PINME_APPKEY 传不进子进程
 * - 专用工具返回结构化 url，避免 Agent 在安装/登录/解析日志里绕圈
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveSafePath } from "../../safePath.js";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

const STATIC_CANDIDATES = ["dist", "build", "out", "public"] as const;

/** 从 pinme CLI 输出里提取最佳公网 URL */
export function extractPinmePublicUrl(output: string): string | null {
  const text = output.replace(/\r/g, "\n");
  const patterns = [
    /https?:\/\/[^\s"'<>]+/gi,
  ];
  const urls: string[] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const u = m[0]!.replace(/[.,;:)\]]+$/, "");
      if (/pinme\.eth\.limo|pinit\.eth\.limo|\.limo|ipfs/i.test(u) || /^https?:\/\//i.test(u)) {
        urls.push(u);
      }
    }
  }
  if (!urls.length) return null;
  // 优先级：非 preview hash > preview
  const ranked = [...urls].sort((a, b) => {
    const score = (u: string) => {
      if (/#\/preview\//i.test(u)) return 1;
      if (/pinit\.eth\.limo|pinme/i.test(u)) return 3;
      return 2;
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

async function resolveUploadDir(
  ctx: NativeToolContext,
  relPath: string,
): Promise<{ abs: string; rel: string }> {
  let p = String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (p.includes("..")) throw new Error("路径不允许包含 ..");

  const wsId = ctx.agentSnapshot?.workspaceId;
  let wsRelPath = "";
  if (wsId && ctx.prisma) {
    const ws = await ctx.prisma.workspace.findUnique({ where: { id: wsId } }).catch(() => null);
    wsRelPath = (ws as { path?: string } | null)?.path?.trim() || "";
  }
  const wsRootAbs = wsRelPath
    ? path.isAbsolute(wsRelPath)
      ? path.resolve(wsRelPath)
      : resolveSafePath(ctx.config, wsRelPath)
    : resolveSafePath(ctx.config, "data/workspace");

  const tryDir = (abs: string, rel: string) => {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
    const index = path.join(abs, "index.html");
    if (!fs.existsSync(index)) {
      throw new Error(`目录缺少 index.html：${rel}（PinMe 需要静态站点入口）`);
    }
    return { abs, rel };
  };

  if (p) {
    // 显式路径：content/ 或相对 Workspace / 项目相对
    let abs: string;
    let rel: string;
    if (p.startsWith("content/") || p.startsWith("workspaces/") || p.startsWith("data/")) {
      abs = resolveSafePath(ctx.config, p);
      rel = p;
    } else {
      abs = path.join(wsRootAbs, p);
      rel = path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/");
    }
    const hit = tryDir(abs, rel);
    if (!hit) throw new Error(`目录不存在或不是文件夹：${rel}`);
    return hit;
  }

  // 自动探测：Workspace 根下 dist/build/out/public，再退项目根
  for (const name of STATIC_CANDIDATES) {
    const abs = path.join(wsRootAbs, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(path.join(abs, "index.html"))) {
      return {
        abs,
        rel: path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/"),
      };
    }
  }
  for (const name of STATIC_CANDIDATES) {
    const abs = resolveSafePath(ctx.config, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(path.join(abs, "index.html"))) {
      return { abs, rel: name };
    }
  }
  // 单文件 demo：Workspace 根若有 index.html
  if (fs.existsSync(path.join(wsRootAbs, "index.html"))) {
    return {
      abs: wsRootAbs,
      rel: path.relative(ctx.config.projectRoot, wsRootAbs).replace(/\\/g, "/") || "data/workspace",
    };
  }
  throw new Error(
    "未找到可上传的静态目录（需含 index.html）。请传 path=dist|build|out|public 或先 write_file 写好页面。",
  );
}

async function resolvePinmeAppKey(ctx: NativeToolContext, args: Record<string, unknown>): Promise<string | null> {
  const fromArg = typeof args.appKey === "string" ? args.appKey.trim() : "";
  if (fromArg) return fromArg;
  const fromEnv = (process.env.PINME_APPKEY || process.env.PINME_APP_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    if (ctx.prisma) {
      const { getCredentialValue } = await import("../../credentialVault.js");
      const v = await getCredentialValue(ctx.prisma, "pinme", "appkey");
      if (v?.trim()) return v.trim();
    }
  } catch {
    /* vault 未就绪 */
  }
  return null;
}

function runPinmeUpload(opts: {
  dirAbs: string;
  domain?: string;
  appKey: string | null;
  timeoutMs: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = ["-y", "pinme", "upload", opts.dirAbs];
  if (opts.domain) {
    args.push("--domain", opts.domain);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 有意保留 PINME_APPKEY（与 run_shell 剥离密钥策略相反——本工具专责部署鉴权）
  if (opts.appKey) {
    env.PINME_APPKEY = opts.appKey;
    env.PINME_APP_KEY = opts.appKey;
  }

  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      cwd: opts.dirAbs,
      env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += "\n[pinme_upload] 超时已终止";
    }, opts.timeoutMs);
    child.stdout?.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr?.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: stderr + "\n" + err.message });
    });
  });
}

async function pinmeUploadTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, rel } = await resolveUploadDir(ctx, String(args.path ?? ""));
  const domain = typeof args.domain === "string" && args.domain.trim() ? args.domain.trim() : undefined;
  const timeoutMs = Math.min(
    Math.max(Number(args.timeoutMs ?? 180_000) || 180_000, 30_000),
    600_000,
  );
  const appKey = await resolvePinmeAppKey(ctx, args);
  if (!appKey) {
    return {
      ok: false,
      path: rel,
      error:
        "缺少 PinMe 鉴权：请在 .env 设置 PINME_APPKEY，或 credentialVault scope=pinme name=appkey，或参数 appKey。也可本机先 `pinme login` / `pinme set-appkey`。",
      hint: "去 https://pinme.eth.limo/ 获取 AppKey 后写入 PINME_APPKEY",
    };
  }

  const result = await runPinmeUpload({ dirAbs: abs, domain, appKey, timeoutMs });
  const combined = `${result.stdout}\n${result.stderr}`;
  const url = extractPinmePublicUrl(combined);
  if (result.exitCode !== 0 || !url) {
    return {
      ok: false,
      path: rel,
      exitCode: result.exitCode,
      error: "pinme upload 失败或未解析到公网 URL",
      stdout: result.stdout.slice(-4000),
      stderr: result.stderr.slice(-2000),
      hint: "确认目录含 index.html；鉴权有效；网络可访问 PinMe",
    };
  }
  return {
    ok: true,
    path: rel,
    url,
    domain: domain ?? null,
    exitCode: result.exitCode,
    note: "把此 url 发给用户即可打开；内容在 IPFS/PinMe 上，无需自备服务器。",
  };
}

const DEPLOY_DEFS: NativeToolDefinition[] = [
  {
    name: "pinme_upload",
    concurrencyClass: "C",
    description:
      "【公网部署】用 PinMe 把静态站点（含 index.html 的目录）上传到公网，返回可分享 URL。适合「写个小工具/HTML 小游戏 → 立刻给链接」。path 省略时自动找 Workspace 或项目下的 dist/build/out/public。需 PINME_APPKEY（或本机已 pinme login）。不要用 run_shell 调 pinme（密钥会被 shell 沙箱剥掉）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对路径：如 dist、demo、workspaces/__assistant__/game（需含 index.html）；省略则自动探测",
        },
        domain: {
          type: "string",
          description: "可选：绑定 PinMe 子域或 DNS 域名（需账号权限）",
        },
        appKey: {
          type: "string",
          description: "可选：一次性 AppKey；优先用环境变量 PINME_APPKEY",
        },
        timeoutMs: {
          type: "number",
          description: "超时毫秒，默认 180000",
        },
      },
    },
  },
];

const DEPLOY_HANDLERS = {
  pinme_upload: pinmeUploadTool,
};

export function registerDeployTools(): void {
  registerNativeDomain(DEPLOY_DEFS, DEPLOY_HANDLERS);
}
