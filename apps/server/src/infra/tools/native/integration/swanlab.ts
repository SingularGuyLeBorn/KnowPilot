/**
 * SwanLab（深度学习实验跟踪）集成
 * https://docs.swanlab.cn — 通过 `swanlab api` CLI 控制云端实验；凭据 scope=swanlab name=api_key。
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { getCredentialValue } from "../../../credentialVault.js";
import { resolveWithinDir } from "../../../safePath.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";

const execFileAsync = promisify(execFile);

function readEnv(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

async function resolveApiKey(ctx: NativeToolContext): Promise<string> {
  const fromDb = ctx.prisma ? await getCredentialValue(ctx.prisma, "swanlab", "api_key") : undefined;
  const key = (fromDb && fromDb.trim()) || readEnv("SWANLAB_API_KEY");
  if (!key) {
    throw new Error(
      "未配置 SwanLab API Key：Credential(scope=swanlab, name=api_key) 或环境变量 SWANLAB_API_KEY。见 https://swanlab.cn",
    );
  }
  return key;
}

function swanlabHost(): string | undefined {
  const h = readEnv("SWANLAB_API_HOST") || readEnv("SWANLAB_HOST");
  return h || undefined;
}

async function runSwanlabApi(
  ctx: NativeToolContext,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const apiKey = await resolveApiKey(ctx);
  const host = swanlabHost();
  const cmdArgs = ["api", ...args, "-k", apiKey];
  if (host) cmdArgs.push("-h", host);
  try {
    const { stdout, stderr } = await execFileAsync("swanlab", cmdArgs, {
      timeout: opts?.timeoutMs ?? 60000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, SWANLAB_API_KEY: apiKey, ...(host ? { SWANLAB_API_HOST: host } : {}) },
    });
    return { ok: true, stdout: stdout || "", stderr: stderr || "", code: 0 };
  } catch (err: unknown) {
    const e = err as {
      code?: number | string;
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (e.code === "ENOENT") {
      throw new Error(
        "未找到 swanlab CLI。请先 `pip install -U swanlab` 并确保 python Scripts 在 PATH。",
      );
    }
    return {
      ok: false,
      stdout: String(e.stdout || ""),
      stderr: String(e.stderr || e.message || ""),
      code: typeof e.status === "number" ? e.status : typeof e.code === "number" ? e.code : null,
    };
  }
}

function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // CLI 有时打印多行；取最后一段 JSON
    const lastObj = t.lastIndexOf("{");
    const lastArr = t.lastIndexOf("[");
    const start = Math.max(lastObj, lastArr);
    if (start >= 0) {
      try {
        return JSON.parse(t.slice(start));
      } catch {
        /* fallthrough */
      }
    }
    return { raw: t.slice(0, 8000) };
  }
}

async function swanlabStatus(_args: Record<string, unknown>, ctx: NativeToolContext) {
  let cli = false;
  let version = "";
  try {
    const { stdout } = await execFileAsync("swanlab", ["--version"], {
      timeout: 15000,
      windowsHide: true,
    });
    cli = true;
    version = stdout.trim();
  } catch {
    cli = false;
  }
  let hasKey = false;
  try {
    await resolveApiKey(ctx);
    hasKey = true;
  } catch {
    hasKey = false;
  }
  let user: unknown = null;
  if (cli && hasKey) {
    const r = await runSwanlabApi(ctx, ["user", "info"], { timeoutMs: 30000 });
    if (r.ok) user = tryParseJson(r.stdout);
  }
  return {
    cliInstalled: cli,
    version: version || null,
    apiKeyConfigured: hasKey,
    host: swanlabHost() || "https://swanlab.cn (default)",
    user,
    hint: !cli
      ? "pip install -U swanlab 后重试"
      : !hasKey
        ? "配置 SWANLAB_API_KEY 或 Credential(scope=swanlab,name=api_key)"
        : "可用 swanlab_project_list / swanlab_run_list / swanlab_run_summary 查实验",
  };
}

async function swanlabUserInfo(_args: Record<string, unknown>, ctx: NativeToolContext) {
  const r = await runSwanlabApi(ctx, ["user", "info"]);
  if (!r.ok) throw new Error(`swanlab user info 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout) };
}

async function swanlabProjectList(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cmd = ["project", "list"];
  if (typeof args.workspace === "string" && args.workspace.trim()) {
    cmd.push("--workspace", args.workspace.trim());
  }
  if (args.all === true) cmd.push("--all");
  const r = await runSwanlabApi(ctx, cmd);
  if (!r.ok) throw new Error(`swanlab project list 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout) };
}

async function swanlabProjectCreate(args: Record<string, unknown>, ctx: NativeToolContext) {
  const name = String(args.name || "").trim();
  if (!name) throw new Error("name 必填");
  const cmd = ["project", "create", "-n", name];
  if (args.visibility === "PUBLIC" || args.visibility === "PRIVATE") {
    cmd.push("-v", String(args.visibility));
  }
  if (typeof args.workspace === "string" && args.workspace.trim()) {
    cmd.push("-w", args.workspace.trim());
  }
  if (typeof args.description === "string" && args.description.trim()) {
    cmd.push("-d", args.description.trim());
  }
  const r = await runSwanlabApi(ctx, cmd);
  if (!r.ok) throw new Error(`swanlab project create 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout) };
}

async function swanlabRunList(args: Record<string, unknown>, ctx: NativeToolContext) {
  const projectPath = String(args.projectPath || "").trim();
  if (!projectPath.includes("/")) {
    throw new Error("projectPath 必填，格式 username/project-name");
  }
  const cmd = ["run", "list", projectPath];
  if (args.all === true) cmd.push("--all");
  const r = await runSwanlabApi(ctx, cmd);
  if (!r.ok) throw new Error(`swanlab run list 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout), projectPath };
}

async function swanlabRunInfo(args: Record<string, unknown>, ctx: NativeToolContext) {
  const runPath = String(args.runPath || "").trim();
  if (!runPath) throw new Error("runPath 必填，格式 username/project/experiment-id");
  const r = await runSwanlabApi(ctx, ["run", "info", runPath]);
  if (!r.ok) throw new Error(`swanlab run info 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout), runPath };
}

async function swanlabRunSummary(args: Record<string, unknown>, ctx: NativeToolContext) {
  const runPath = String(args.runPath || "").trim();
  if (!runPath) throw new Error("runPath 必填");
  const cmd = ["run", "summary", runPath];
  if (typeof args.keys === "string" && args.keys.trim()) {
    cmd.push("--keys", args.keys.trim());
  }
  const r = await runSwanlabApi(ctx, cmd);
  if (!r.ok) throw new Error(`swanlab run summary 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout), runPath };
}

async function swanlabRunMetrics(args: Record<string, unknown>, ctx: NativeToolContext) {
  const runPath = String(args.runPath || "").trim();
  const keys = String(args.keys || "").trim();
  if (!runPath) throw new Error("runPath 必填");
  if (!keys) throw new Error("keys 必填，如 loss,acc");
  const cmd = ["run", "metrics", runPath, "--keys", keys];
  if (typeof args.sample === "number" && args.sample > 0) {
    cmd.push("-s", String(Math.min(Math.floor(args.sample), 1500)));
  }
  if (args.all === true) cmd.push("--all");
  const r = await runSwanlabApi(ctx, cmd, { timeoutMs: 120000 });
  if (!r.ok) throw new Error(`swanlab run metrics 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout), runPath, keys };
}

async function swanlabRunSeries(args: Record<string, unknown>, ctx: NativeToolContext) {
  const runPath = String(args.runPath || "").trim();
  if (!runPath) throw new Error("runPath 必填");
  const cmd = ["run", "series", runPath];
  if (args.type === "media" || args.type === "scalar") cmd.push("--type", String(args.type));
  if (typeof args.search === "string" && args.search.trim()) {
    cmd.push("--search", args.search.trim());
  }
  const r = await runSwanlabApi(ctx, cmd);
  if (!r.ok) throw new Error(`swanlab run series 失败: ${r.stderr || r.stdout}`);
  return { data: tryParseJson(r.stdout), runPath };
}

/** 在当前 Agent Workspace 写入可运行的 SwanLab 训练脚手架（Python） */
async function swanlabScaffoldTrain(args: Record<string, unknown>, ctx: NativeToolContext) {
  const project = String(args.project || "knowpilot-exp").trim() || "knowpilot-exp";
  const fileName = String(args.fileName || "train_swanlab.py").trim() || "train_swanlab.py";
  if (!/^[\w.-]+\.py$/i.test(fileName)) throw new Error("fileName 须为简单 .py 文件名");

  let baseDir = path.join(ctx.config.dataDir, "workspace");
  const wid = ctx.agentSnapshot?.workspaceId;
  if (wid && ctx.prisma) {
    const ws = await ctx.prisma.workspace.findUnique({
      where: { id: wid },
      select: { path: true },
    });
    if (ws?.path) {
      baseDir = path.isAbsolute(ws.path)
        ? ws.path
        : path.join(ctx.config.projectRoot, ws.path);
    }
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const abs = resolveWithinDir(baseDir, fileName);

  const snippet = `#!/usr/bin/env python3
"""KnowPilot 生成的 SwanLab 训练脚手架 — ${project}
依赖: pip install -U swanlab
凭据: 环境变量 SWANLAB_API_KEY，或先 swanlab login
"""
from __future__ import annotations

import random
import time

import swanlab

def main() -> None:
    run = swanlab.init(
        project=${JSON.stringify(project)},
        experiment_name=None,  # 自动命名
        config={
            "lr": 3e-4,
            "batch_size": 32,
            "epochs": 5,
            "model": "toy-mlp",
            "source": "knowpilot-scaffold",
        },
    )
    print("swanlab run:", getattr(run, "public_run_url", None) or getattr(run, "url", ""))

    for epoch in range(1, 6):
        loss = 1.0 / epoch + random.random() * 0.05
        acc = 1.0 - loss + random.random() * 0.02
        swanlab.log({"train/loss": loss, "train/acc": min(acc, 0.999), "epoch": epoch})
        # 模拟一步训练
        time.sleep(0.2)
        print(f"epoch={epoch} loss={loss:.4f} acc={acc:.4f}")

    swanlab.finish()
    print("done")

if __name__ == "__main__":
    main()
`;
  fs.writeFileSync(abs, snippet, "utf-8");
  const rel = path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/");
  return {
    path: rel,
    project,
    hint: `在该目录执行: pip install -U swanlab && set SWANLAB_API_KEY=... && python ${fileName}`,
  };
}

export const swanlabDefs: NativeToolDefinition[] = [
  {
    name: "swanlab_status",
    description:
      "检查 SwanLab CLI/API Key 是否就绪，并尝试拉当前用户信息。深度学习实验跟踪（类似 W&B）。",
    concurrencyClass: "B",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "swanlab_user_info",
    description: "SwanLab 当前登录用户信息（需 SWANLAB_API_KEY）。",
    concurrencyClass: "B",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "swanlab_project_list",
    description: "列出 SwanLab 工作空间下的项目。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "工作空间用户名；默认当前用户" },
        all: { type: "boolean", description: "翻页取全部" },
      },
    },
  },
  {
    name: "swanlab_project_create",
    description: "创建 SwanLab 项目。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        visibility: { type: "string", enum: ["PRIVATE", "PUBLIC"] },
        workspace: { type: "string" },
        description: { type: "string" },
      },
    },
  },
  {
    name: "swanlab_run_list",
    description: "列出项目下实验。projectPath=username/project-name。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      required: ["projectPath"],
      properties: {
        projectPath: { type: "string" },
        all: { type: "boolean" },
      },
    },
  },
  {
    name: "swanlab_run_info",
    description: "获取单个实验详情。runPath=username/project/experiment-id。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      required: ["runPath"],
      properties: { runPath: { type: "string" } },
    },
  },
  {
    name: "swanlab_run_summary",
    description: "实验标量指标汇总（最终/最小/最大等）。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      required: ["runPath"],
      properties: {
        runPath: { type: "string" },
        keys: { type: "string", description: "可选，逗号分隔如 loss,acc" },
      },
    },
  },
  {
    name: "swanlab_run_metrics",
    description: "拉取实验标量曲线（采样）。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      required: ["runPath", "keys"],
      properties: {
        runPath: { type: "string" },
        keys: { type: "string", description: "逗号分隔指标名" },
        sample: { type: "number" },
        all: { type: "boolean" },
      },
    },
  },
  {
    name: "swanlab_run_series",
    description: "列出实验指标 key（scalar/media）。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      required: ["runPath"],
      properties: {
        runPath: { type: "string" },
        type: { type: "string", enum: ["scalar", "media"] },
        search: { type: "string" },
      },
    },
  },
  {
    name: "swanlab_scaffold_train",
    description:
      "在当前 Agent Workspace 写入 SwanLab 训练脚手架 train_swanlab.py（含 init/log/finish）。训练仍由用户/子 Agent 用 run_shell 执行。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "SwanLab 项目名，默认 knowpilot-exp" },
        fileName: { type: "string", description: "默认 train_swanlab.py" },
      },
    },
  },
];

export const swanlabHandlers: Record<string, NativeToolHandler> = {
  swanlab_status: swanlabStatus,
  swanlab_user_info: swanlabUserInfo,
  swanlab_project_list: swanlabProjectList,
  swanlab_project_create: swanlabProjectCreate,
  swanlab_run_list: swanlabRunList,
  swanlab_run_info: swanlabRunInfo,
  swanlab_run_summary: swanlabRunSummary,
  swanlab_run_metrics: swanlabRunMetrics,
  swanlab_run_series: swanlabRunSeries,
  swanlab_scaffold_train: swanlabScaffoldTrain,
};
