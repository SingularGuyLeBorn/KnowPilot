/**
 * Swarm 轻量阶段工件（SOP 接力）——落在 Workspace `.knowpilot/stages/`。
 * 父/管理 Agent 读工件，不读子会话正文（守隔离铁律）。
 */
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { resolveWithinDir } from "./safePath.js";

const STAGE_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export type SwarmStageWriteInput = {
  workspaceId?: string;
  /** 阶段名，如 research / draft / review */
  stage: string;
  title?: string;
  body: string;
  /** 可选任务关联 id（session/task/job） */
  taskRef?: string;
  authorAgentId?: string;
};

export type SwarmStageMeta = {
  stage: string;
  fileName: string;
  relPath: string;
  title: string;
  taskRef?: string;
  authorAgentId?: string;
  updatedAt: string;
  bytes: number;
};

async function resolveWorkspaceStagesDir(
  prisma: PrismaClient,
  config: AppConfig,
  workspaceId?: string,
): Promise<{ absDir: string; workspaceId: string | null }> {
  let wid = workspaceId?.trim() || "";
  if (!wid) {
    const root = await prisma.workspace.findFirst({
      where: { isSystem: true },
      select: { id: true, path: true },
    });
    if (!root?.path) {
      const fallback = path.join(config.dataDir, "stages", "_root");
      fs.mkdirSync(fallback, { recursive: true });
      return { absDir: fallback, workspaceId: null };
    }
    wid = root.id;
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: wid },
    select: { id: true, path: true },
  });
  if (!ws?.path) throw new Error(`Workspace 不存在或无 path: ${wid}`);
  const wsAbs = path.isAbsolute(ws.path)
    ? ws.path
    : path.join(config.projectRoot, ws.path);
  const stagesDir = path.join(wsAbs, ".knowpilot", "stages");
  fs.mkdirSync(stagesDir, { recursive: true });
  return { absDir: stagesDir, workspaceId: ws.id };
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[k] = v;
  }
  return { meta, body };
}

export async function writeSwarmStage(
  prisma: PrismaClient,
  config: AppConfig,
  input: SwarmStageWriteInput,
): Promise<SwarmStageMeta> {
  const stage = String(input.stage || "").trim();
  if (!STAGE_SLUG_RE.test(stage)) {
    throw new Error("stage 须为 1–64 位字母数字/._-，且以字母数字开头");
  }
  const body = String(input.body ?? "");
  if (!body.trim()) throw new Error("body 不能为空");
  const { absDir, workspaceId } = await resolveWorkspaceStagesDir(
    prisma,
    config,
    input.workspaceId,
  );
  const title = (input.title || stage).trim().slice(0, 200);
  const fileName = `${stage}.md`;
  const absFile = resolveWithinDir(absDir, fileName);
  const now = new Date().toISOString();
  const fm = [
    "---",
    `stage: ${JSON.stringify(stage)}`,
    `title: ${JSON.stringify(title)}`,
    `updatedAt: ${JSON.stringify(now)}`,
    input.taskRef ? `taskRef: ${JSON.stringify(String(input.taskRef).slice(0, 128))}` : null,
    input.authorAgentId
      ? `authorAgentId: ${JSON.stringify(String(input.authorAgentId).slice(0, 64))}`
      : null,
    workspaceId ? `workspaceId: ${JSON.stringify(workspaceId)}` : null,
    "---",
    "",
    body.replace(/\r\n/g, "\n").trimEnd(),
    "",
  ]
    .filter((x) => x != null)
    .join("\n");
  fs.writeFileSync(absFile, fm, "utf-8");
  const relPath = path.relative(config.projectRoot, absFile).replace(/\\/g, "/");
  return {
    stage,
    fileName,
    relPath,
    title,
    taskRef: input.taskRef,
    authorAgentId: input.authorAgentId,
    updatedAt: now,
    bytes: Buffer.byteLength(fm, "utf-8"),
  };
}

export async function listSwarmStages(
  prisma: PrismaClient,
  config: AppConfig,
  opts: { workspaceId?: string } = {},
): Promise<SwarmStageMeta[]> {
  const { absDir } = await resolveWorkspaceStagesDir(prisma, config, opts.workspaceId);
  if (!fs.existsSync(absDir)) return [];
  const files = fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort();
  const out: SwarmStageMeta[] = [];
  for (const fileName of files) {
    const abs = path.join(absDir, fileName);
    const raw = fs.readFileSync(abs, "utf-8");
    const { meta } = parseFrontmatter(raw);
    const stage = meta.stage || fileName.replace(/\.md$/i, "");
    const st = fs.statSync(abs);
    out.push({
      stage,
      fileName,
      relPath: path.relative(config.projectRoot, abs).replace(/\\/g, "/"),
      title: meta.title || stage,
      taskRef: meta.taskRef,
      authorAgentId: meta.authorAgentId,
      updatedAt: meta.updatedAt || st.mtime.toISOString(),
      bytes: st.size,
    });
  }
  return out;
}

export async function readSwarmStage(
  prisma: PrismaClient,
  config: AppConfig,
  opts: { workspaceId?: string; stage: string },
): Promise<{ meta: SwarmStageMeta; body: string }> {
  const stage = String(opts.stage || "").trim();
  if (!STAGE_SLUG_RE.test(stage)) throw new Error("非法 stage 名");
  const { absDir } = await resolveWorkspaceStagesDir(prisma, config, opts.workspaceId);
  const absFile = resolveWithinDir(absDir, `${stage}.md`);
  if (!fs.existsSync(absFile)) throw new Error(`阶段工件不存在: ${stage}`);
  const raw = fs.readFileSync(absFile, "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  const st = fs.statSync(absFile);
  return {
    meta: {
      stage: meta.stage || stage,
      fileName: `${stage}.md`,
      relPath: path.relative(config.projectRoot, absFile).replace(/\\/g, "/"),
      title: meta.title || stage,
      taskRef: meta.taskRef,
      authorAgentId: meta.authorAgentId,
      updatedAt: meta.updatedAt || st.mtime.toISOString(),
      bytes: st.size,
    },
    body: body.trimEnd(),
  };
}
