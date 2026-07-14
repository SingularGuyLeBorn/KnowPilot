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
import { resolveSafePath } from "../../safePath.js";
import type { AppConfig } from "../../config.js";
import type { ToolRollback } from "../types.js";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

/** 回收站根目录名（projectRoot 下，safePath 沙箱内） */
const TRASH_DIR_NAME = ".trash";

/** 计算回收站目标：`.trash/<时间戳>-<随机>/<原相对路径>`，时间戳段避免跨 run 同路径碰撞 */
function moveToTrash(config: AppConfig, abs: string, relPath: string): string {
  const stamp =
    new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) +
    "-" +
    Math.random().toString(36).slice(2, 8);
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const trashRel = `${TRASH_DIR_NAME}/${stamp}/${normalized}`;
  const trashAbs = resolveSafePath(config, trashRel);
  fs.mkdirSync(path.dirname(trashAbs), { recursive: true });
  fs.renameSync(abs, trashAbs);
  return trashRel;
}

async function readFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  if (!fs.statSync(abs).isFile()) throw new Error("目标不是文件");
  const maxChars = Number(args.maxChars || 12000);
  const offset = Math.max(0, Number(args.offset || 0));
  const content = fs.readFileSync(abs, "utf8");
  const totalChars = content.length;
  const slice = content.slice(offset, offset + maxChars);
  return {
    path: args.path,
    offset,
    totalChars,
    truncated: totalChars > offset + maxChars,
    content: slice,
  };
}

async function writeFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function appendToFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function listDirectoryTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path || "."));
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${args.path || "."}`);
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
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持删除目录，请指定文件: ${args.path}`);
  const trashPath = moveToTrash(ctx.config, abs, String(args.path));
  return { path: args.path, deleted: true, trashPath };
}

async function fileRenameTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持重命名目录: ${args.path}`);
  const newName = String(args.newName || "").trim();
  if (!newName) throw new Error("newName 不能为空");
  if (newName.includes("/") || newName.includes("\\")) throw new Error("newName 不能包含目录分隔符");
  const dest = path.join(path.dirname(abs), newName);
  if (!dest.startsWith(path.resolve(ctx.config.projectRoot))) throw new Error("目标路径超出项目根目录范围");
  if (fs.existsSync(dest)) throw new Error(`目标已存在: ${newName}`);
  fs.renameSync(abs, dest);
  return { from: args.path, to: path.relative(ctx.config.projectRoot, dest).replace(/\\/g, "/") };
}

async function fileMoveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持移动目录: ${args.path}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const destAbs = resolveSafePath(ctx.config, destRel);
  if (fs.existsSync(destAbs)) throw new Error(`目标已存在: ${destRel}`);
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(abs, destAbs);
  return { from: args.path, to: destRel };
}

async function fileCopyTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  if (!fs.statSync(abs).isFile()) throw new Error(`只能复制文件: ${args.path}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const destAbs = resolveSafePath(ctx.config, destRel);
  if (fs.existsSync(destAbs)) throw new Error(`目标已存在: ${destRel}`);
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(abs, destAbs);
  return { from: args.path, to: destRel };
}

async function searchFilesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const root = resolveSafePath(ctx.config, String(args.path || "."));
  if (!fs.existsSync(root)) throw new Error(`目录不存在: ${args.path || "."}`);
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
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (fs.existsSync(abs)) throw new Error(`路径已存在: ${args.path}`);
  fs.mkdirSync(abs, { recursive: true });
  return { path: args.path, created: true };
}

async function fileStatTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件或目录不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  return {
    path: args.path,
    exists: true,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

async function directoryDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`目标不是目录: ${args.path}`);
  // 语义保持：非 recursive 只允许删空目录（原 rmdirSync 行为），recursive 才删非空
  if (args.recursive !== true && fs.readdirSync(abs).length > 0) {
    throw new Error(`目录非空，需 recursive=true 才能删除: ${args.path}`);
  }
  const trashPath = moveToTrash(ctx.config, abs, String(args.path));
  return { path: args.path, deleted: true, trashPath };
}

const FS_DEFS: NativeToolDefinition[] = [
  {
    name: "read_file",
    concurrencyClass: "A",
    description: "读取项目根目录内的文本文件（相对路径），支持偏移与最大长度。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径，如 content/posts/foo.md" },
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
    description: "写入项目根目录内的文本文件（相对路径）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "append_to_file",
    concurrencyClass: "D",
    description: "在项目根目录内的文本文件末尾追加内容（文件不存在则创建）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
        content: { type: "string", description: "追加内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    concurrencyClass: "A",
    description: "列出项目内目录内容，可选递归。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录，默认 ." },
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
    description: "删除项目根目录内的空目录（移入 .trash 回收站）；设置 recursive=true 可递归删除。",
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
    description: "删除项目根目录内的文件（移入 .trash 回收站，可恢复）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
      },
      required: ["path"],
    },
  }
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
      const abs = resolveSafePath(ctx.config, String(args.path));
      if (!fs.existsSync(abs)) return { existed: false };
      return { existed: true, content: fs.readFileSync(abs, "utf8") };
    },
    compensate: async (args, _result, captured, ctx) => {
      const abs = resolveSafePath(ctx.config, String(args.path));
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
  const origAbs = resolveSafePath(ctx.config, String(args.path));
  if (fs.existsSync(origAbs)) {
    throw new Error(`原路径已存在新内容（${args.path}），为避免覆盖未移回；回收站副本保留于 ${trashPath}，需人工合并`);
  }
  fs.mkdirSync(path.dirname(origAbs), { recursive: true });
  fs.renameSync(trashAbs, origAbs);
  return "已从回收站移回原路径";
}

export function registerFsTools(): void {
  registerNativeDomain(FS_DEFS, FS_HANDLERS, FS_ROLLBACKS);
}
