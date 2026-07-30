/**
 * 截图 drop 扫描与 OCR 入库
 */

import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { performOcrFromFile } from "../ocrService.js";
import {
  ensureInboxDirs,
  getInboxRoot,
  resolveScreenshotWatchDir,
  upsertInboxItem,
  truncate,
  InboxSyncProgressTracker,
  type InboxSyncProgressFn,
  type InboxSyncResult,
} from "./shared.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".bmp"]);

export async function scanScreenshotDrop(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    dir?: string;
    maxFiles?: number;
    runOcr?: boolean;
    onProgress?: InboxSyncProgressFn;
  } = {},
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const dir = opts.dir?.trim()
    ? path.isAbsolute(opts.dir)
      ? opts.dir
      : path.join(config.projectRoot, opts.dir)
    : resolveScreenshotWatchDir(config);
  fs.mkdirSync(dir, { recursive: true });
  const maxFiles = opts.maxFiles ?? 50;
  const runOcr = opts.runOcr !== false;
  const progress = new InboxSyncProgressTracker(opts.onProgress);

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [`无法读取截图目录 ${dir}: ${err instanceof Error ? err.message : String(err)}`],
      items: [],
    };
  }

  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const abs = path.join(dir, e.name);
      const st = fs.statSync(abs);
      return { abs, name: e.name, mtime: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles);

  const archiveDir = path.join(getInboxRoot(config), "screenshots", "archived");
  fs.mkdirSync(archiveDir, { recursive: true });

  const result: InboxSyncResult = {
    scanned: files.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  progress.setTotal(files.length);

  for (const file of files) {
    try {
      const buf = fs.readFileSync(file.abs);
      const externalId = crypto.createHash("sha1").update(buf).digest("hex");
      const destName = `${externalId}${path.extname(file.name).toLowerCase()}`;
      const destAbs = path.join(archiveDir, destName);
      if (!fs.existsSync(destAbs)) {
        fs.copyFileSync(file.abs, destAbs);
      }
      const contentPath = path.relative(config.projectRoot, destAbs).replace(/\\/g, "/");

      let content: string | null = null;
      let excerpt: string | null = null;
      let title = `截图 ${file.name}`;
      const metadata: Record<string, unknown> = {
        originalName: file.name,
        size: file.size,
        mtime: new Date(file.mtime).toISOString(),
        watchDir: dir,
      };

      if (runOcr) {
        const ocr = await performOcrFromFile(config, destAbs, "auto");
        if (ocr.success && ocr.text) {
          content = truncate(ocr.text, 20000);
          excerpt = ocr.text.slice(0, 280);
          const firstLine = ocr.text.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
          if (firstLine) title = firstLine.slice(0, 80);
          metadata.ocrEngine = ocr.engine;
        } else {
          metadata.ocrError = ocr.error || "OCR 无结果";
        }
      }

      const upserted = await upsertInboxItem(prisma, {
        source: "screenshot",
        externalId,
        title,
        excerpt,
        content,
        contentPath,
        tags: ["screenshot"],
        metadata,
      });
      if (upserted.created) result.created += 1;
      else result.updated += 1;
      result.items.push(upserted);
      progress.success();

      // 成功入库后从 drop 移除原文件（已归档副本）
      if (path.resolve(file.abs).startsWith(path.resolve(path.join(getInboxRoot(config), "screenshots", "drop")))) {
        fs.unlinkSync(file.abs);
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
