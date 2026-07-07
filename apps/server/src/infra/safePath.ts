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
