/**
 * OCR 门禁：坏图/徽章 URL 不得进 Tesseract 主进程。
 */
import { describe, it, expect } from "vitest";
import { detectRasterImageKind, isOcrSkippableUrl } from "../infra/ocrService.js";

describe("OCR image / URL 门禁", () => {
  it("识别常见位图魔数", () => {
    expect(detectRasterImageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "png",
    );
    expect(detectRasterImageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe("jpeg");
    expect(detectRasterImageKind(Buffer.from("<svg xmlns="))).toBeNull();
    expect(detectRasterImageKind(Buffer.from("GIF89a......"))).toBe("gif");
  });

  it("跳过徽章 / SVG / favicon URL", () => {
    expect(isOcrSkippableUrl("https://awesome.re/badge.svg")).toBe(true);
    expect(isOcrSkippableUrl("https://img.shields.io/github/last-commit/x")).toBe(true);
    expect(isOcrSkippableUrl("https://example.com/photo.png")).toBe(false);
    expect(isOcrSkippableUrl("https://cdn.example.com/favicon.ico")).toBe(true);
  });
});
