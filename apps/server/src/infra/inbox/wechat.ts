/**
 * 微信公众号链接 drop 入库
 */

import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import {
  ensureInboxDirs,
  captureInboxUrls,
  type InboxSyncProgressFn,
  type InboxSyncResult,
} from "./shared.js";

export async function ingestWechatDropFile(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    fetchContent?: boolean;
    maxChars?: number;
    maxUrls?: number;
    onProgress?: InboxSyncProgressFn;
  } = {},
): Promise<InboxSyncResult> {
  const { wechatLinks, wechat } = ensureInboxDirs(config);
  const raw = fs.readFileSync(wechatLinks, "utf-8");
  const lines = raw.split(/\r?\n/);
  const urls: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      kept.push(line);
      continue;
    }
    const m = t.match(/https?:\/\/[^\s]+/i);
    if (m) urls.push(m[0].replace(/[),.;]+$/, ""));
    else kept.push(line);
  }

  const maxUrls = opts.maxUrls ?? 50;
  const batch = urls.slice(0, maxUrls);
  const result = await captureInboxUrls(prisma, config, {
    urls: batch,
    source: "wechat",
    fetchContent: opts.fetchContent !== false,
    maxChars: opts.maxChars,
    onProgress: opts.onProgress,
  });

  // 已处理 URL 归档
  if (batch.length) {
    const donePath = path.join(wechat, "links.done.txt");
    const stamp = new Date().toISOString();
    fs.appendFileSync(donePath, `\n# ${stamp}\n${batch.join("\n")}\n`, "utf-8");
  }
  const remaining = urls.slice(maxUrls);
  const next = [
    "# 每行一个微信公众号文章链接（或任意 URL）",
    "# 同步后已处理的行会移到 links.done.txt",
    ...kept.filter((l) => l.trim().startsWith("#") || !l.trim()),
    ...remaining,
    "",
  ].join("\n");
  fs.writeFileSync(wechatLinks, next, "utf-8");
  return result;
}
