/**
 * 供 platform/parser 使用的 OCR 桥接 — 复用 KnowPilot ocrService
 */

import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { URL } from "url";
import { getAppConfig } from "../config.js";
import { performOcrFromFile } from "../ocrService.js";

const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads", "ocr");

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function getRefererForUrl(url: string): string {
  if (url.includes("mmbiz.qpic.cn") || url.includes("mmbiz.qlogo.cn")) {
    return "https://mp.weixin.qq.com/";
  }
  if (url.includes("zhimg.com")) {
    return "https://zhuanlan.zhihu.com/";
  }
  if (url.includes("byteimg.com")) {
    return "https://www.toutiao.com/";
  }
  return "";
}

export async function downloadImageToTemp(url: string): Promise<string> {
  ensureUploadDir();
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;
    const referer = getRefererForUrl(url);
    const ext = path.extname(parsed.pathname) || ".png";
    const tempName = `ocr_dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const tempPath = path.join(UPLOAD_DIR, tempName);

    const request = protocol.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: referer,
        },
        timeout: 15000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`上游返回 HTTP ${response.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            fs.writeFileSync(tempPath, Buffer.concat(chunks));
            resolve(tempPath);
          } catch (err: unknown) {
            reject(new Error(`保存临时文件失败: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      },
    );

    request.on("error", (err) => reject(new Error(`下载失败: ${err.message}`)));
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("下载超时"));
    });
    request.end();
  });
}

export interface OCRResult {
  text: string;
  engine: string;
  success: boolean;
  error?: string;
}

export async function ocrRemoteImage(url: string, language = "auto"): Promise<OCRResult> {
  const tempPath = await downloadImageToTemp(url);
  try {
    const config = getAppConfig();
    return await performOcrFromFile(config, tempPath, language);
  } finally {
    fs.unlink(tempPath, () => undefined);
  }
}
