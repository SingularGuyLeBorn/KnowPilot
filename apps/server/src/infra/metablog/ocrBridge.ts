/**
 * 供 platform/parser 使用的 OCR 桥接 — 复用 KnowPilot ocrService
 */

import fs from "fs";
import path from "path";
import { URL } from "url";
import { getAppConfig } from "../config.js";
import {
  detectRasterImageKind,
  isOcrSkippableUrl,
  performOcrFromFile,
} from "../ocrService.js";

const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads", "ocr");

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** 平台 CDN 防盗链 Referer（download_file / OCR / 素材包共用） */
export function getRefererForUrl(url: string): string {
  if (url.includes("mmbiz.qpic.cn") || url.includes("mmbiz.qlogo.cn")) {
    return "https://mp.weixin.qq.com/";
  }
  if (url.includes("zhimg.com")) {
    return "https://zhuanlan.zhihu.com/";
  }
  if (url.includes("byteimg.com")) {
    return "https://www.toutiao.com/";
  }
  if (url.includes("xhscdn.com") || url.includes("xiaohongshu.com")) {
    return "https://www.xiaohongshu.com/";
  }
  if (url.includes("hdslb.com") || url.includes("bilibili.com")) {
    return "https://www.bilibili.com/";
  }
  if (url.includes("sinaimg.cn")) {
    return "https://weibo.com/";
  }
  return "";
}

export async function downloadImageToTemp(url: string): Promise<string> {
  ensureUploadDir();
  const parsed = new URL(url);
  const referer = getRefererForUrl(url);
  const ext = path.extname(parsed.pathname) || ".png";
  const tempName = `ocr_dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const tempPath = path.join(UPLOAD_DIR, tempName);

  // 用 fetch 跟随重定向（旧 http.request 遇 GitHub 302 直接失败）
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`上游返回 HTTP ${res.status}`);
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("image/svg")) {
    throw new Error(`上游 Content-Type 不支持 OCR: ${contentType || "unknown"}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!detectRasterImageKind(buf)) {
    throw new Error("下载内容不是位图（PNG/JPEG/GIF/WEBP/BMP）");
  }
  fs.writeFileSync(tempPath, buf);
  return tempPath;
}

export interface OCRResult {
  text: string;
  engine: string;
  success: boolean;
  error?: string;
}

export async function ocrRemoteImage(url: string, language = "auto"): Promise<OCRResult> {
  if (isOcrSkippableUrl(url)) {
    return {
      text: "",
      engine: "none",
      success: false,
      error: "URL 已跳过 OCR（徽章/SVG/favicon）",
    };
  }
  const tempPath = await downloadImageToTemp(url);
  try {
    const config = getAppConfig();
    return await performOcrFromFile(config, tempPath, language);
  } finally {
    fs.unlink(tempPath, () => undefined);
  }
}
