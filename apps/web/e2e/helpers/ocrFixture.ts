/**
 * E2E：OCR 环境探测与测试图路径
 */

import fs from "fs";
import path from "path";
import { trpcMutate, trpcQuery } from "./trpcE2e";

const ROOT = path.resolve(__dirname, "../../../..");

export const OCR_SAMPLE_IMAGE = path.join(ROOT, "content/uploads/00_abstract_mqxw9uuq.png");

type ApiResult<T> = { success: boolean; data?: T; error?: { message?: string } };

export interface OcrStatusPayload {
  ready: boolean;
  modelsReady: boolean;
  paddleCli: boolean;
  probe: { launcher: string; paddleImportOk: boolean; error?: string };
}

export async function fetchOcrStatus(): Promise<OcrStatusPayload | null> {
  try {
    const res = await trpcQuery<ApiResult<OcrStatusPayload>>("agent.ocrStatus");
    return res.success ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

export function ocrSampleExists(): boolean {
  return fs.existsSync(OCR_SAMPLE_IMAGE);
}

export function readOcrSampleBase64(): string {
  return fs.readFileSync(OCR_SAMPLE_IMAGE).toString("base64");
}

/** 真实 OCR API 冒烟（不走 mock） */
export async function runRealOcrApi(): Promise<{ text: string; engine?: string }> {
  const res = await trpcMutate<
    ApiResult<{ text: string; source: string; engine?: string }>
  >("agent.ocrImage", {
    base64: readOcrSampleBase64(),
    mimeType: "image/png",
    chatSupportsVision: false,
  });
  if (!res.success || !res.data?.text?.trim()) {
    throw new Error(res.error?.message ?? "agent.ocrImage 未返回文字");
  }
  return { text: res.data.text, engine: res.data.engine };
}
