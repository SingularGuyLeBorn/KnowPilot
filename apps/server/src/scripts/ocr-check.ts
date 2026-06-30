/**
 * OCR 环境诊断 — 模型 / Python / 试识别
 * 用法: pnpm --filter @knowpilot/server ocr:check
 */

import path from "path";
import fs from "fs";
import { loadRootEnv, getAppConfig } from "../infra/config.js";
import { getOcrStatus, probeOcrPython, performOcrFromFile } from "../infra/ocrService.js";

loadRootEnv();
const config = getAppConfig();

async function main() {
  const status = getOcrStatus(config);
  const probe = await probeOcrPython(config);

  console.log("=== OCR 状态 ===");
  console.log(JSON.stringify({ ...status, probe }, null, 2));

  const sample = path.join(config.projectRoot, "content/uploads/00_abstract_mqxw9uuq.png");
  if (!fs.existsSync(sample)) {
    console.log("\n⚠ 无测试图 content/uploads/00_abstract_mqxw9uuq.png，跳过试识别");
    process.exitCode = probe.paddleImportOk ? 0 : 1;
    return;
  }

  console.log("\n=== 试识别 ===", sample);
  const t0 = Date.now();
  const result = await performOcrFromFile(config, sample, "auto");
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t0,
        success: result.success,
        engine: result.engine,
        textLen: result.text.length,
        preview: result.text.slice(0, 200),
        error: result.error?.split("\n")[0],
      },
      null,
      2,
    ),
  );

  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
