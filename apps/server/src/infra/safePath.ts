/**
 * 路径安全工具：所有 Agent 可触达的文件/Git 操作路径必须经此校验，
 * 确保解析后的绝对路径在项目根目录之内，阻止绝对路径或 .. 穿越。
 */
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

/** 禁止最终落点进入知识库核心（posts/about），堵住 Workspace.path 绕过 write 隔离 */
export function assertAbsNotKnowledgeCore(config: AppConfig, absPath: string): void {
  const rel = path.relative(path.resolve(config.projectRoot), path.resolve(absPath)).replace(/\\/g, "/");
  if (rel.startsWith("..")) return;
  if (
    rel === "content/posts" ||
    rel.startsWith("content/posts/") ||
    rel === "content/about" ||
    rel.startsWith("content/about/")
  ) {
    throw new Error(
      `禁止写入知识库核心路径 ${rel}：文章/About 必须走 post_create/post_update；Workspace.path 也不得指向 content/posts|about`,
    );
  }
}

/** Workspace 创建时校验 path 不得指向知识库核心或敏感 config 根 */
export function assertWorkspacePathAllowed(config: AppConfig, workspacePath: string): void {
  const normalized = String(workspacePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) throw new Error("Workspace path 不能为空");
  if (normalized.includes("..")) throw new Error("Workspace path 不允许包含 ..");
  const abs = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : resolveSafePath(config, normalized);
  assertAbsNotKnowledgeCore(config, abs);
  const rel = path.relative(path.resolve(config.projectRoot), abs).replace(/\\/g, "/");
  if (rel === "config" || rel.startsWith("config/agents") || rel.startsWith("config/skills")) {
    throw new Error(`Workspace path 禁止指向 Agent 配置区：${rel}`);
  }
}
