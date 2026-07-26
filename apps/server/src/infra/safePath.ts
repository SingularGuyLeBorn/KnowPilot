/**
 * 路径安全工具：所有 Agent 可触达的文件/Git 操作路径必须经此校验，
 * 确保解析后的绝对路径在项目根目录之内，阻止绝对路径或 .. 穿越。
 *
 * D7：写路径在词法校验之外，对已存在祖先做 realpath，堵住 symlink/Junction 逃逸。
 */
import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";

/** 校验绝对路径必须位于 projectRoot 之内，否则抛错。 */
export function assertPathWithinProjectRoot(config: AppConfig, absPath: string): void {
  const root = path.resolve(config.projectRoot);
  const normalized = path.resolve(absPath);
  // 用 root + path.sep 前缀匹配，避免 `D:/foo` 误命中 `D:/foobar`
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (normalized !== root && !normalized.startsWith(prefix)) {
    throw new Error(`路径超出项目根目录范围：${absPath}（projectRoot=${root}）`);
  }
}

/**
 * 把相对路径解析到 projectRoot 内的绝对路径，禁 .. 与绝对路径。
 * 返回绝对路径；不通过则抛错。
 */
export function resolveSafePath(config: AppConfig, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("路径不允许包含 ..");
  // 拒绝绝对路径（Windows 盘符 / UNC / Unix 根）
  if (/^[a-zA-Z]:[\\/]/.test(normalized) || /^[\\/]/.test(normalized) || normalized.startsWith("//")) {
    throw new Error(`路径不允许为绝对路径：${relPath}`);
  }
  const abs = path.resolve(config.projectRoot, normalized);
  assertPathWithinProjectRoot(config, abs);
  return abs;
}

/**
 * 校验绝对路径必须位于 dir 之内，否则抛错。用于 Workspace 隔离。
 */
export function assertPathWithinDir(dir: string, absPath: string): void {
  const root = path.resolve(dir);
  const normalized = path.resolve(absPath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (normalized !== root && !normalized.startsWith(prefix)) {
    throw new Error(`路径超出目录范围：${absPath}（dir=${root}）`);
  }
}

/**
 * 把相对路径解析到指定 dir 内的绝对路径，禁 .. 与绝对路径。
 * 用于 Agent Workspace 隔离：write_file 默认落到当前 Agent 的 Workspace 目录。
 */
export function resolveWithinDir(dir: string, relPath: string): string {
  const normalized = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("路径不允许包含 ..");
  if (/^[a-zA-Z]:[\\/]/.test(normalized) || /^[\\/]/.test(normalized) || normalized.startsWith("//")) {
    throw new Error(`路径不允许为绝对路径：${relPath}`);
  }
  const abs = path.resolve(dir, normalized);
  assertPathWithinDir(dir, abs);
  return abs;
}

/**
 * 解析写目标的真实落点：对最近已存在祖先 realpath，再拼回尚未创建的后缀。
 * 目标本身已存在时直接 realpath（跟随 symlink/Junction）。
 */
export function resolveRealWriteTarget(absPath: string): string {
  const resolved = path.resolve(absPath);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync(resolved);
  }
  const missing: string[] = [];
  let cur = resolved;
  while (!fs.existsSync(cur)) {
    missing.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (!fs.existsSync(cur)) return resolved;
  return path.resolve(fs.realpathSync(cur), ...missing);
}

/**
 * 禁止最终落点进入 content/（除 content/uploads/）。
 * 动态花园与 about 一律走 garden_* / post_*；uploads 供截图等上传。
 */
export function assertAbsNotKnowledgeCore(config: AppConfig, absPath: string): void {
  const rel = path.relative(path.resolve(config.projectRoot), path.resolve(absPath)).replace(/\\/g, "/");
  if (rel.startsWith("..")) return;
  const underContent = rel === "content" || rel.startsWith("content/");
  const underUploads = rel === "content/uploads" || rel.startsWith("content/uploads/");
  if (underContent && !underUploads) {
    throw new Error(
      `禁止写入知识库路径 ${rel}：文章须走 post_create/post_update；建库/改首页走 garden_*；About 禁止 AI 写；仅 content/uploads/ 可经 write_file 写`,
    );
  }
}

/**
 * D7 写路径完整校验：词法在根内 + 非知识库核心 + realpath 后再校验一次。
 * 所有 Agent 写文件路径在落盘前必须经过此函数。
 */
export function assertWritePathSafe(config: AppConfig, absPath: string): void {
  const lexical = path.resolve(absPath);
  assertPathWithinProjectRoot(config, lexical);
  assertAbsNotKnowledgeCore(config, lexical);
  const real = resolveRealWriteTarget(lexical);
  assertPathWithinProjectRoot(config, real);
  assertAbsNotKnowledgeCore(config, real);
}

/** Workspace 创建时校验 path 不得指向知识库核心或敏感 config 根 */
export function assertWorkspacePathAllowed(config: AppConfig, workspacePath: string): void {
  const normalized = String(workspacePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) throw new Error("Workspace path 不能为空");
  if (normalized.includes("..")) throw new Error("Workspace path 不允许包含 ..");
  const abs = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : resolveSafePath(config, normalized);
  assertWritePathSafe(config, abs);
  const rel = path.relative(path.resolve(config.projectRoot), path.resolve(abs)).replace(/\\/g, "/");
  if (rel === "config" || rel.startsWith("config/agents") || rel.startsWith("config/skills")) {
    throw new Error(`Workspace path 禁止指向 Agent 配置区：${rel}`);
  }
}
