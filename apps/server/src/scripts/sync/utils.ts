/**
 * 同步脚本通用工具函数
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { load as loadYaml } from "js-yaml";

/**
 * 定位 content 子目录（自适应执行路径）
 * 优先从当前工作目录找，找不到则向上回退两级（适配 pnpm 脚本在 apps/server 下执行时 cwd 不同）
 */
export function getContentDir(dirName: string): string {
  let dir = path.resolve(process.cwd(), `content/${dirName}`);
  if (!fs.existsSync(dir)) {
    dir = path.resolve(process.cwd(), `../../content/${dirName}`);
  }
  return dir;
}

/**
 * 递归获取目录下所有指定扩展名的文件。
 * `_` 开头的目录（如 content/agents/_templates/）是模板/元数据目录，
 * 一律跳过，不同步为实体（W9）。
 */
export function getFilesRecursive(dir: string, extensions: string[], ignoreDirs: string[] = ["images", "public", "assets"]): string[] {
  if (!fs.existsSync(dir)) return [];

  let results: string[] = [];
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!file.startsWith("_") && !ignoreDirs.includes(file)) {
        results = results.concat(getFilesRecursive(filePath, extensions, ignoreDirs));
      }
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
  return relativePath.replace(/\\/g, "/").replace(/\.[^/.]+$/, "");
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
