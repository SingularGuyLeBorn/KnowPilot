/**
 * Native FS 域 — read/write/list/search/directory
 */
import fs from "fs";
import path from "path";
import { resolveSafePath } from "../../safePath.js";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

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
  fs.unlinkSync(abs);
  return { path: args.path, deleted: true };
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
  if (args.recursive === true) {
    fs.rmSync(abs, { recursive: true, force: true });
  } else {
    fs.rmdirSync(abs);
  }
  return { path: args.path, deleted: true };
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
    description: "删除项目根目录内的空目录；设置 recursive=true 可递归删除。",
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
    description: "删除项目根目录内的文件（相对路径）。",
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

export function registerFsTools(): void {
  registerNativeDomain(FS_DEFS, FS_HANDLERS);
}
