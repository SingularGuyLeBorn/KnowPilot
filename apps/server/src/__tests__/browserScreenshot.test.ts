/**
 * browser_screenshot / read_image — 落盘路径 + OCR/vision 编排（mock 浏览器与 OCR）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";

vi.mock("../infra/metablog/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/metablog/index.js")>();
  return {
    ...actual,
    screenshotPage: vi.fn(),
  };
});

vi.mock("../infra/ocrService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/ocrService.js")>();
  return {
    ...actual,
    performOcrFromFile: vi.fn(),
  };
});

vi.mock("../infra/llmClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/llmClient.js")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

import { screenshotPage } from "../infra/metablog/index.js";
import { performOcrFromFile } from "../infra/ocrService.js";
import { chatCompletion } from "../infra/llmClient.js";
import { executeNativeTool, listNativeTools } from "../infra/nativeTools.js";

describe("browser_screenshot / read_image", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    vi.mocked(screenshotPage).mockReset();
    vi.mocked(performOcrFromFile).mockReset();
    vi.mocked(chatCompletion).mockReset();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("注册表包含 browser_screenshot 与 read_image", () => {
    const names = listNativeTools().map((d) => d.name);
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("read_image");
  });

  it("browser_screenshot 落盘 PNG 并返回 path + suggestedTool=read_image", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    vi.mocked(screenshotPage).mockResolvedValue({
      success: true,
      data: {
        url: "https://example.com/page",
        title: "Example",
        buffer: png,
        width: 1280,
        height: 800,
        fullPage: false,
      },
    });

    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "browser_screenshot",
      { url: "https://example.com/page" },
      ctx,
    )) as {
      path: string;
      publicUrl: string;
      bytes: number;
      suggestedTool: string;
      title: string;
    };

    expect(result.title).toBe("Example");
    expect(result.suggestedTool).toBe("read_image");
    expect(result.path).toMatch(/^content\/uploads\/screenshots\/.+\.png$/);
    expect(result.publicUrl).toMatch(/^\/uploads\/screenshots\/.+\.png$/);
    expect(result.bytes).toBe(png.length);
    expect(fs.existsSync(path.join(root, result.path))).toBe(true);
  });

  it("read_image(path, mode=ocr) 调用 OCR 并只回文本", async () => {
    const rel = "content/uploads/screenshots/unit-test.png";
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from("fake-png"));

    vi.mocked(performOcrFromFile).mockResolvedValue({
      success: true,
      text: "Hello from OCR",
      engine: "mock-ocr",
    });

    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "read_image",
      { path: rel, mode: "ocr" },
      ctx,
    )) as { text: string; source: string; engine: string };

    expect(result.text).toBe("Hello from OCR");
    expect(result.source).toBe("ocr");
    expect(result.engine).toBe("mock-ocr");
    expect(vi.mocked(performOcrFromFile)).toHaveBeenCalledOnce();
  });

  it("read_image(path, mode=vision) 走 chatCompletion 多模态", async () => {
    const rel = "content/uploads/screenshots/vision-test.png";
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from("fake-png"));

    vi.mocked(chatCompletion).mockResolvedValue({
      content: "页面标题是 KnowPilot",
      reasoningContent: null,
      toolCalls: [],
      tokenUsage: { prompt: 10, completion: 5, total: 15 },
      model: "deepseek-vl2",
      finishReason: "stop",
      provider: "deepseek",
    });

    const ctx = createNativeCtx(root);
    ctx.agentSnapshot = {
      id: "a1",
      model: "deepseek-v4-flash",
      systemPrompt: "",
      tools: ["native:read_image"],
    };

    const result = (await executeNativeTool(
      "read_image",
      { path: rel, mode: "vision", prompt: "描述页面" },
      ctx,
    )) as { text: string; source: string; model: string };

    expect(result.source).toBe("vision");
    expect(result.text).toContain("KnowPilot");
    expect(vi.mocked(chatCompletion)).toHaveBeenCalledOnce();
    const call = vi.mocked(chatCompletion).mock.calls[0][0];
    expect(Array.isArray(call.messages[0].content)).toBe(true);
  });

  it("read_image 缺少 path/url 时抛错", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("read_image", {}, ctx)).rejects.toThrow(/path 与 url/);
  });
});
