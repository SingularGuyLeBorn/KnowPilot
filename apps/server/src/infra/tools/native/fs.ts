/**
 * Native FS 域 — read/write/list/search/directory
 *
 * D 类工具回滚（W6）：write_file 执行前快照旧内容；file_delete/directory_delete
 * 执行时移入项目根 `.trash/` 回收站（而非物理删除），run 失败回滚 = 移回。
 * .trash 清理策略：run 成功后回收站内容保留，由用户手动清理（不在进程内自动清，
 * 避免误删用户还想恢复的文件）；已在回收站内的目标再删会嵌套入站，无害。
 */
import fs from "fs";
import path from "path";
import {
  resolveSafePath,
  resolveWithinDir,
  assertPathWithinDir,
  assertWritePathSafe,
} from "../../safePath.js";
import {
  listTrash,
  moveToTrash,
  restoreFromTrash,
} from "../../fsMutationGate.js";
import type { ToolRollback } from "../types.js";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

/** content/ 写入白名单：仅 uploads；其余 content/（含动态花园与 about）禁 write_file */
const CONTENT_WRITE_PREFIXES = ["content/uploads/"] as const;

/** 算法可视化工程：允许 read_file / list_directory；写入走 native:algo_viz_create */
const ALGO_VIZ_ROOT = "apps/algo-viz";

function isAlgoVizProjectPath(p: string): boolean {
  return p === ALGO_VIZ_ROOT || p.startsWith(`${ALGO_VIZ_ROOT}/`);
}

/**
 * Agent FS 路径单点（读写对称）：
 * - content/：读任意知识库；写仅 content/uploads/
 * - apps/algo-viz/：只读（对照样例）；创建/注册动画用 algo_viz_create
 * - 其余：落到当前 Agent Workspace（无 Workspace → data/workspace/）
 * - list/search 默认 Workspace 根，禁止裸扫项目根
 */
/** 供 web.download_file 等跨域工具复用（写路径规则与 write_file 一致） */
export async function resolveAgentFsPath(
  ctx: NativeToolContext,
  relPath: string,
  mode: "read" | "write",
): Promise<{ abs: string; relForReturn: string }> {
  let p = String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p === ".") p = "";
  if (p.includes("..")) throw new Error("路径不允许包含 ..");
  if (/^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]/.test(p) || p.startsWith("//")) {
    throw new Error(`路径不允许为绝对路径：${relPath}`);
  }
  if (p.startsWith("content/") || p === "content") {
    if (mode === "write") {
      const allowed = CONTENT_WRITE_PREFIXES.some((a) => p.startsWith(a));
      if (!allowed) {
        throw new Error(
          `禁止 write_file 直写 ${p}：content/ 仅 uploads 可写；建库/首页走 garden_*，文章走 post_*`,
        );
      }
      // uploads/viz 只收媒体成品；Remotion 源码必须走 algo_viz_create（禁止再甩 deploy 脚本给用户）
      if (
        (p === "content/uploads/viz" || p.startsWith("content/uploads/viz/")) &&
        !/\.(mp4|webm|png|jpe?g|webp|gif|svg)$/i.test(p)
      ) {
        throw new Error(
          `禁止 write_file 写动画源码到 ${p}：请用 native:algo_viz_create（自动写入 apps/algo-viz 并注册）。` +
            "content/uploads/viz/ 仅可放 mp4/海报等媒体。禁止让用户跑 cp/deploy 脚本。",
        );
      }
    }
    if (p === "content") p = "content";
    const abs = resolveSafePath(ctx.config, p || "content");
    if (mode === "write") assertWritePathSafe(ctx.config, abs);
    return { abs, relForReturn: p || "content" };
  }

  if (isAlgoVizProjectPath(p)) {
    if (mode === "write") {
      throw new Error(
        `禁止 write_file 写 ${p}：请用 native:algo_viz_create 创建并自动注册动画组件`,
      );
    }
    const packageRootAbs = resolveSafePath(ctx.config, ALGO_VIZ_ROOT);
    const abs =
      p === ALGO_VIZ_ROOT
        ? packageRootAbs
        : resolveWithinDir(packageRootAbs, p.slice(`${ALGO_VIZ_ROOT}/`.length));
    assertPathWithinDir(packageRootAbs, abs);
    return { abs, relForReturn: p };
  }

  const wsId = ctx.agentSnapshot?.workspaceId;
  let wsRelPath = "";
  if (wsId && ctx.prisma) {
    const ws = await ctx.prisma.workspace.findUnique({ where: { id: wsId } }).catch(() => null);
    wsRelPath = (ws as { path?: string } | null)?.path?.trim() || "";
  }
  if (!wsRelPath) {
    const fallback = p ? `data/workspace/${p}` : "data/workspace";
    const abs = resolveSafePath(ctx.config, fallback);
    if (mode === "write") assertWritePathSafe(ctx.config, abs);
    return { abs, relForReturn: fallback };
  }
  const wsAbs = path.isAbsolute(wsRelPath) ? path.resolve(wsRelPath) : resolveSafePath(ctx.config, wsRelPath);
  const abs = p ? resolveWithinDir(wsAbs, p) : wsAbs;
  if (mode === "write") assertWritePathSafe(ctx.config, abs);
  const relForReturn = path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/");
  return { abs, relForReturn };
}

async function readFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "read");
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${relForReturn}`);
  if (!fs.statSync(abs).isFile()) throw new Error("目标不是文件");
  const maxChars = Number(args.maxChars || 12000);
  const offset = Math.max(0, Number(args.offset || 0));
  const content = fs.readFileSync(abs, "utf8");
  const totalChars = content.length;
  const slice = content.slice(offset, offset + maxChars);
  return {
    path: relForReturn,
    offset,
    totalChars,
    truncated: totalChars > offset + maxChars,
    content: slice,
  };
}

async function writeFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: relForReturn, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function appendToFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: relForReturn, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function listDirectoryTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path || "."), "read");
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${relForReturn}`);
  if (args.recursive === true) {
    const entries: Array<{ path: string; type: "file" | "directory" }> = [];
    function walk(dir: string, prefix: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        entries.push({ path: rel.replace(/\\/g, "/"), type: e.isDirectory() ? "directory" : "file" });
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      }
    }
    walk(abs, path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/"));
    return entries;
  }
  return fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "directory" : "file",
  }));
}
async function fileDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${relForReturn}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持删除目录，请指定文件: ${relForReturn}`);
  const trashPath = moveToTrash(ctx.config, abs, relForReturn);
  return {
    path: relForReturn,
    deleted: true,
    softDelete: true,
    trashPath,
    hint: "已软删进回收站。恢复：trash_restore(trashPath=…)",
  };
}

async function fileRenameTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${relForReturn}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持重命名目录: ${relForReturn}`);
  const newName = String(args.newName || "").trim();
  if (!newName) throw new Error("newName 不能为空");
  if (newName.includes("/") || newName.includes("\\")) throw new Error("newName 不能包含目录分隔符");
  const dest = path.join(path.dirname(abs), newName);
  if (!dest.startsWith(path.resolve(ctx.config.projectRoot))) throw new Error("目标路径超出项目根目录范围");
  if (fs.existsSync(dest)) throw new Error(`目标已存在: ${newName}`);
  fs.renameSync(abs, dest);
  return { from: relForReturn, to: path.relative(ctx.config.projectRoot, dest).replace(/\\/g, "/") };
}

async function fileMoveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const src = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (!fs.existsSync(src.abs)) throw new Error(`文件不存在: ${src.relForReturn}`);
  const stat = fs.statSync(src.abs);
  if (stat.isDirectory()) throw new Error(`不支持移动目录: ${src.relForReturn}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const dest = await resolveAgentFsPath(ctx, destRel, "write");
  if (fs.existsSync(dest.abs)) throw new Error(`目标已存在: ${dest.relForReturn}`);
  const destDir = path.dirname(dest.abs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(src.abs, dest.abs);
  return { from: src.relForReturn, to: dest.relForReturn };
}

async function fileCopyTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const src = await resolveAgentFsPath(ctx, String(args.path), "read");
  if (!fs.existsSync(src.abs)) throw new Error(`文件不存在: ${src.relForReturn}`);
  if (!fs.statSync(src.abs).isFile()) throw new Error(`只能复制文件: ${src.relForReturn}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const dest = await resolveAgentFsPath(ctx, destRel, "write");
  if (fs.existsSync(dest.abs)) throw new Error(`目标已存在: ${dest.relForReturn}`);
  const destDir = path.dirname(dest.abs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src.abs, dest.abs);
  return { from: src.relForReturn, to: dest.relForReturn };
}

async function searchFilesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const rooted = await resolveAgentFsPath(ctx, String(args.path || "."), "read");
  const root = rooted.abs;
  if (!fs.existsSync(root)) throw new Error(`目录不存在: ${rooted.relForReturn}`);
  const rawPattern = String(args.pattern || "");
  if (!rawPattern) throw new Error("pattern 不能为空");
  const isRegex = args.isRegex === true;
  const caseSensitive = args.caseSensitive === true;
  const flags = caseSensitive ? "" : "i";
  const regex = isRegex
    ? new RegExp(rawPattern, flags)
    : new RegExp(rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  const maxResults = Math.min(200, Math.max(1, Number(args.maxResults || 30)));
  const glob = args.glob ? String(args.glob) : undefined;
  const globRegex = glob
    ? new RegExp(
        "^" +
          glob
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
        flags,
      )
    : undefined;
  const results: Array<{ file: string; line: number; snippet: string }> = [];
  const skipDirs = new Set(["node_modules", ".git", ".next", "dist", "out", "tmp", "weights", "backups"]);

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (globRegex && !globRegex.test(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (
        [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".mp3", ".pdf", ".zip", ".gz", ".exe", ".dll", ".db", ".db-wal", ".db-shm"].includes(ext)
      ) {
        continue;
      }
      try {
        const text = fs.readFileSync(abs, "utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && regex.test(line)) {
            results.push({
              file: path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/"),
              line: i + 1,
              snippet: line.slice(0, 160),
            });
            if (results.length >= maxResults) return;
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
  }

  walk(root);
  return { pattern: rawPattern, isRegex, caseSensitive, glob: glob ?? null, total: results.length, results };
}

async function directoryCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (fs.existsSync(abs)) throw new Error(`路径已存在: ${relForReturn}`);
  fs.mkdirSync(abs, { recursive: true });
  return { path: relForReturn, created: true };
}

async function fileStatTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "read");
  if (!fs.existsSync(abs)) throw new Error(`文件或目录不存在: ${relForReturn}`);
  const stat = fs.statSync(abs);
  return {
    path: relForReturn,
    exists: true,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

async function directoryDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${relForReturn}`);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`目标不是目录: ${relForReturn}`);
  // 语义保持：非 recursive 只允许删空目录（原 rmdirSync 行为），recursive 才删非空
  if (args.recursive !== true && fs.readdirSync(abs).length > 0) {
    throw new Error(`目录非空，需 recursive=true 才能删除: ${relForReturn}`);
  }
  const trashPath = moveToTrash(ctx.config, abs, relForReturn);
  return {
    path: relForReturn,
    deleted: true,
    softDelete: true,
    trashPath,
    hint: "已软删进回收站。恢复：trash_restore(trashPath=…)",
  };
}

async function trashListTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50)));
  const items = listTrash(ctx.config, limit);
  return {
    total: items.length,
    items,
    hint: "恢复用 trash_restore(trashPath)。文章回收站另见 post 回收站 UI / post.restore。",
  };
}

async function trashRestoreTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const trashPath = String(args.trashPath ?? "").trim();
  if (!trashPath) throw new Error("trashPath 不能为空");
  const result = restoreFromTrash(ctx.config, trashPath);
  return { ...result, restored: true, hint: "已从回收站移回原路径（软删可逆）" };
}

const FS_DEFS: NativeToolDefinition[] = [
  {
    name: "read_file",
    concurrencyClass: "A",
    description:
      "读取文本文件。path：content/… 知识库；apps/algo-viz/… 算法动画工程；否则相对当前 Agent Workspace（禁止裸扫项目根/config/其它 apps）。支持偏移与最大长度。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "content/…、apps/algo-viz/… 或 Workspace 相对路径",
        },
        maxChars: { type: "number", description: "最大读取字符数，默认 12000" },
        offset: { type: "number", description: "起始字符偏移，默认 0" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    concurrencyClass: "D",
    destructive: true,
    // 可回滚的常规写入，非删除类——不因 AGENT_DESTRUCTIVE_APPROVAL 拦截日常写文件
    approvalExempt: true,
    description:
      "写入文本文件。允许 content/uploads/…；禁止直写其它 content/（文章走 post_*）与 apps/algo-viz（动画用 algo_viz_create）。其余相对当前 Agent Workspace。禁止 .. 与绝对路径。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "content/uploads/… 或 Workspace 相对路径（如 demo.html）",
        },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "append_to_file",
    concurrencyClass: "D",
    description:
      "在文本文件末尾追加内容（文件不存在则创建）。路径规则同 write_file（uploads 白名单 + Workspace；algo-viz 请用 algo_viz_create）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "content/uploads/… 或 Workspace 相对路径",
        },
        content: { type: "string", description: "追加内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    concurrencyClass: "A",
    description:
      "列出目录内容（默认当前 Agent Workspace 根，可选递归）。path=content/… 或 apps/algo-viz/… 可列对应子树。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对 Workspace、content/… 或 apps/algo-viz/…；默认 Workspace 根",
        },
        recursive: { type: "boolean", description: "是否递归列出子目录，默认 false" },
      },
    },
  },
  {
    name: "file_rename",
    concurrencyClass: "D",
    description: "重命名项目根目录内的文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        newName: { type: "string", description: "新文件名（不含目录）" },
      },
      required: ["path", "newName"],
    },
  },
  {
    name: "file_move",
    concurrencyClass: "D",
    description: "移动项目根目录内的文件到另一个相对路径。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        dest: { type: "string", description: "目标相对路径（含文件名）" },
      },
      required: ["path", "dest"],
    },
  },
  {
    name: "file_copy",
    concurrencyClass: "D",
    description: "复制项目根目录内的文件到另一个相对路径。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        dest: { type: "string", description: "目标相对路径（含文件名）" },
      },
      required: ["path", "dest"],
    },
  },
  {
    name: "search_files",
    concurrencyClass: "A",
    description: "在项目根目录内搜索包含指定关键词的文本文件，返回文件路径、行号与片段。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "搜索关键词或正则表达式" },
        path: { type: "string", description: "相对起始目录，默认 ." },
        isRegex: { type: "boolean", description: "是否将 pattern 视为正则表达式，默认 false（字面量匹配）" },
        caseSensitive: { type: "boolean", description: "是否区分大小写，默认 false" },
        glob: { type: "string", description: "文件名通配过滤，如 *.md" },
        maxResults: { type: "number", description: "最大返回结果数，默认 30" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "directory_create",
    concurrencyClass: "D",
    description: "在项目根目录内创建目录（自动创建父目录）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "file_stat",
    concurrencyClass: "A",
    description: "获取项目根目录内文件或目录的元信息。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "directory_delete",
    concurrencyClass: "D",
    destructive: true,
    description:
      "软删除目录：移入项目根 .trash/ 回收站（可 trash_restore 恢复）。空目录默认可删；非空需 recursive=true。禁止用 run_shell rm。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录路径" },
        recursive: { type: "boolean", description: "是否递归删除非空目录，默认 false" },
      },
      required: ["path"],
    },
  },
  {
    name: "file_delete",
    concurrencyClass: "D",
    destructive: true,
    description:
      "软删除文件：移入项目根 .trash/ 回收站（可 trash_restore 恢复）。禁止用 run_shell rm/del。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "trash_list",
    concurrencyClass: "A",
    description: "列出项目根 .trash/ 回收站中可恢复的软删条目（stamp + originalPath + trashPath）。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "最多返回条数，默认 50，上限 200" },
      },
    },
  },
  {
    name: "trash_restore",
    concurrencyClass: "D",
    destructive: true,
    approvalExempt: true,
    description:
      "从 .trash/ 恢复此前 file_delete/directory_delete 软删的路径。传入 trash_list 返回的 trashPath。",
    parameters: {
      type: "object",
      properties: {
        trashPath: {
          type: "string",
          description: "回收站相对路径，如 .trash/20260729…/workspaces/…/demo.html",
        },
      },
      required: ["trashPath"],
    },
  },
];

const FS_HANDLERS = {
  read_file: readFileTool,
  write_file: writeFileTool,
  append_to_file: appendToFileTool,
  list_directory: listDirectoryTool,
  file_rename: fileRenameTool,
  file_move: fileMoveTool,
  file_copy: fileCopyTool,
  search_files: searchFilesTool,
  directory_create: directoryCreateTool,
  directory_delete: directoryDeleteTool,
  file_stat: fileStatTool,
  file_delete: fileDeleteTool,
  trash_list: trashListTool,
  trash_restore: trashRestoreTool,
};

/**
 * D 类工具幂等补偿（W6）：
 * - write_file：capture 快照旧内容（不存在记 existed=false），compensate 写回快照/删除新建文件；
 * - file_delete / directory_delete：执行时已移入 .trash（trashPath 在结果里），compensate 移回。
 * 幂等保证：快照写回天然幂等；回收站移回在副本已不存在时视为已回滚跳过。
 */
const FS_ROLLBACKS: Record<string, ToolRollback<NativeToolContext>> = {
  write_file: {
    capture: async (args, ctx) => {
      const { abs } = await resolveAgentFsPath(ctx, String(args.path), "write");
      if (!fs.existsSync(abs)) return { existed: false };
      return { existed: true, content: fs.readFileSync(abs, "utf8") };
    },
    compensate: async (args, _result, captured, ctx) => {
      const { abs } = await resolveAgentFsPath(ctx, String(args.path), "write");
      const data = captured as { existed?: boolean; content?: string } | undefined;
      if (!data?.existed) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        return "已删除本 run 新建的文件";
      }
      fs.writeFileSync(abs, data.content ?? "", "utf8");
      return "已还原写入前快照";
    },
  },
  file_delete: {
    compensate: async (args, result, _captured, ctx) => moveBackFromTrash(ctx, args, result),
  },
  directory_delete: {
    compensate: async (args, result, _captured, ctx) => moveBackFromTrash(ctx, args, result),
  },
};

/** file_delete / directory_delete 共用补偿：把回收站副本移回原路径（幂等） */
async function moveBackFromTrash(
  ctx: NativeToolContext,
  args: Record<string, unknown>,
  result: unknown,
): Promise<string> {
  const trashPath = (result as { trashPath?: string } | undefined)?.trashPath;
  if (!trashPath) return "无回收站路径（可能已恢复），幂等跳过";
  const trashAbs = resolveSafePath(ctx.config, trashPath);
  if (!fs.existsSync(trashAbs)) return "回收站副本已不存在（视为已回滚），幂等跳过";
  const { abs: origAbs, relForReturn } = await resolveAgentFsPath(ctx, String(args.path), "write");
  if (fs.existsSync(origAbs)) {
    throw new Error(`原路径已存在新内容（${relForReturn}），为避免覆盖未移回；回收站副本保留于 ${trashPath}，需人工合并`);
  }
  fs.mkdirSync(path.dirname(origAbs), { recursive: true });
  fs.renameSync(trashAbs, origAbs);
  return "已从回收站移回原路径";
}

export function registerFsTools(): void {
  registerNativeDomain(FS_DEFS, FS_HANDLERS, FS_ROLLBACKS);
}
