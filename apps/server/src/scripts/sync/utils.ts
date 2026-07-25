/**
 * 同步脚本通用工具函数
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { load as loadYaml } from "js-yaml";
import { getAppConfig } from "../../infra/config.js";

/**
 * 定位存储子目录（统一读 AppConfig，消灭与 KP_*_DIR 双轨）
 * posts/about/uploads → contentPaths；agents/skills/mcp/memories/tasks/prompts/sources → configPaths；
 * 其余（运行时产物）→ dataPaths。测试通过 KP_CONTENT_DIR/KP_CONFIG_DIR/KP_DATA_DIR 隔离。
 */
export function getContentDir(dirName: string): string {
  const config = getAppConfig();
  const cp = config.contentPaths as Record<string, string>;
  const gp = config.configPaths as Record<string, string>;
  const dp = config.dataPaths as Record<string, string>;
  if (gp[dirName]) return gp[dirName];
  if (cp[dirName]) return cp[dirName];
  if (dp[dirName]) return dp[dirName];
  // 未知目录名：保守回退到 config 根（旧默认行为是 content 根，但配置类实体已迁 config）
  return path.join(config.configDir, dirName);
}

/** 路径比较前统一为正斜杠（Windows 反斜杠与 POSIX 模板对齐） */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * 递归获取目录下所有指定扩展名的文件。
 * 默认跳过：
 * - `_` 开头目录（如 config/agents/_templates/，W9）
 * - `.` 开头目录（如 posts/.trash/ 回收站，D2）
 * - ignoreDirs 显式名单（images/public/assets/.trash）
 */
export function getFilesRecursive(
  dir: string,
  extensions: string[],
  ignoreDirs: string[] = ["images", "public", "assets", ".trash"],
): string[] {
  if (!fs.existsSync(dir)) return [];

  let results: string[] = [];
  const list = fs.readdirSync(dir);
  const ignoreSet = new Set(ignoreDirs);

  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // `.`/`_` 开头与 ignoreDirs 一律跳过，各 syncer 不再自行做路径字符串过滤
      if (file.startsWith(".") || file.startsWith("_") || ignoreSet.has(file)) {
        continue;
      }
      results = results.concat(getFilesRecursive(filePath, extensions, ignoreDirs));
    } else if (extensions.some((ext) => file.endsWith(ext))) {
      results.push(filePath);
    }
  }

  return results;
}

/** 解析 Markdown 文件：返回 frontmatter 数据 + 正文 */
export function parseMarkdownFile(filePath: string): { data: Record<string, any>; content: string; fileName: string } {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath);
  const { data, content } = matter(fileContent);
  return { data, content, fileName };
}

/** 解析 YAML 文件 */
export function parseYamlFile(filePath: string): { data: Record<string, any>; fileName: string } {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath);
  const data = loadYaml(fileContent) as Record<string, any> || {};
  return { data, fileName };
}

/** 从文件路径生成 slug（相对路径、正斜杠、去扩展名） */
export function filePathToSlug(contentDir: string, filePath: string): string {
  const relativePath = path.relative(contentDir, filePath);
  return toPosixPath(relativePath).replace(/\.[^/.]+$/, "");
}

/** 安全读取字符串数组（支持 YAML 数组或逗号分隔字符串） */
export function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/** 安全读取布尔值 */
export function readBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

/** 获取文件最后修改时间 */
export function getFileMtime(filePath: string): Date {
  return fs.statSync(filePath).mtime;
}

/** 安全读取数字 */
export function readNumber(value: unknown, defaultValue: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}
