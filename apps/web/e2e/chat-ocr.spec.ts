import { test, expect } from "@playwright/test";
import {
  fetchOcrStatus,
  ocrSampleExists,
  runRealOcrApi,
} from "./helpers/ocrFixture";

test.describe("Chat OCR", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("agent.ocrImage 真实识别测试图", async () => {
    test.skip(!ocrSampleExists(), "缺少 content/uploads/00_abstract_mqxw9uuq.png");

    const status = await fetchOcrStatus();
    test.skip(!status?.ready, "OCR 环境未就绪，请运行 pnpm ocr:setup && pnpm ocr:check");

    const { text, engine } = await runRealOcrApi();
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/GRPO|DeepSeek|token/i);
    expect(engine).toBe("PaddleOCR");
  });
});
