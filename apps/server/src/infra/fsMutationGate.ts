/**
 * FS 变更闸门：进程内唯一允许的「让路径消失」原语 = 移入 .trash（软删除）。
 * Agent / native 删除工具必须走此模块；禁止对知识库/工作区硬 unlink。
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";
import { resolveSafePath, assertPathWithinDir } from "./safePath.js";

export const TRASH_DIR_NAME = ".trash";

export type TrashEntry = {
  trashPath: string;
  originalPath: string;
  stamp: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
};

function projectRootAbs(config: AppConfig): string {
  return path.resolve(config.projectRoot);
}

function trashRootAbs(config: AppConfig): string {
  return resolveSafePath(config, TRASH_DIR_NAME);
}

/** 相对 projectRoot 的规范化路径 */
export function toProjectRel(config: AppConfig, abs: string): string {
  return path.relative(projectRootAbs(config), abs).replace(/\\/g, "/");
}

/**
 * 把 abs 移入 `.trash/<stamp>/<原相对路径>`，返回 trash 相对路径。
 * 禁止硬 unlink：唯一合法「消失」手段。
 */
export function moveToTrash(config: AppConfig, abs: string, relPath?: string): string {
  const root = projectRootAbs(config);
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root)) {
    throw new Error(`禁止移出项目根之外的路径：${abs}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`路径不存在，无法软删：${abs}`);
  }
  const normalized =
    (relPath ?? toProjectRel(config, resolved)).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === TRASH_DIR_NAME || normalized.startsWith(`${TRASH_DIR_NAME}/`)) {
    throw new Error(`禁止对回收站自身执行软删：${normalized || abs}`);
  }
  const stamp =
    new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) +
    "-" +
    Math.random().toString(36).slice(2, 8);
  const trashRel = `${TRASH_DIR_NAME}/${stamp}/${normalized}`;
  const trashAbs = resolveSafePath(config, trashRel);
  fs.mkdirSync(path.dirname(trashAbs), { recursive: true });
  const tRoot = trashRootAbs(config);
  assertPathWithinDir(tRoot, trashAbs);
  fs.renameSync(resolved, trashAbs);
  return trashRel;
}

/** 从回收站移回原路径（幂等：原路径已有内容则抛错，避免覆盖） */
export function restoreFromTrash(
  config: AppConfig,
  trashRel: string,
): { originalPath: string; trashPath: string } {
  const trashAbs = resolveSafePath(config, trashRel);
  const trashRoot = trashRootAbs(config);
  assertPathWithinDir(trashRoot, trashAbs);
  if (!fs.existsSync(trashAbs)) {
    throw new Error(`回收站条目不存在：${trashRel}`);
  }
  const parts = trashRel.replace(/\\/g, "/").split("/");
  // .trash / stamp / original...
  if (parts[0] !== TRASH_DIR_NAME || parts.length < 3) {
    throw new Error(`非法回收站路径：${trashRel}`);
  }
  const originalRel = parts.slice(2).join("/");
  if (!originalRel) throw new Error(`无法从回收站路径还原原路径：${trashRel}`);
  const originalAbs = resolveSafePath(config, originalRel);
  if (fs.existsSync(originalAbs)) {
    throw new Error(
      `原路径已存在新内容（${originalRel}），未覆盖；回收站副本保留于 ${trashRel}`,
    );
  }
  fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
  fs.renameSync(trashAbs, originalAbs);
  return { originalPath: originalRel, trashPath: trashRel };
}

function dirSizeApprox(abs: string): number {
  try {
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const name of fs.readdirSync(abs)) {
      n += dirSizeApprox(path.join(abs, name));
      if (n > 50_000_000) break;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * 列出 `.trash/<stamp>/<根项>`（按次软删聚合，不扫全部叶子）。
 */
export function listTrash(config: AppConfig, limit = 50): TrashEntry[] {
  const root = trashRootAbs(config);
  if (!fs.existsSync(root)) return [];
  const out: TrashEntry[] = [];
  for (const stamp of fs.readdirSync(root)) {
    const stampAbs = path.join(root, stamp);
    if (!fs.statSync(stampAbs).isDirectory()) continue;
    for (const name of fs.readdirSync(stampAbs)) {
      const abs = path.join(stampAbs, name);
      const st = fs.statSync(abs);
      const trashPath = toProjectRel(config, abs);
      const originalPath = trashPath.split("/").slice(2).join("/");
      out.push({
        trashPath,
        originalPath,
        stamp,
        isDirectory: st.isDirectory(),
        sizeBytes: st.isDirectory() ? dirSizeApprox(abs) : st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, Math.max(1, Math.min(200, limit)));
}
