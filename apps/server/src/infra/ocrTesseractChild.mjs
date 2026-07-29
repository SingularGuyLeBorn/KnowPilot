/**
 * Tesseract.js 子进程入口 —— 与主 server 进程隔离。
 * tesseract Worker 在坏图（SVG/损坏字节）上会 nextTick 抛未捕获异常，
 * 若跑在主进程会直接打死 Node；放子进程则只影响本次 OCR。
 *
 * 用法: node ocrTesseractChild.mjs <imagePath> <lang>
 * stdout: JSON { ok, text?, error? }
 */
import { createWorker } from "tesseract.js";

const imagePath = process.argv[2];
const lang = process.argv[3] || "eng";

function write(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  if (!imagePath) {
    write({ ok: false, error: "缺少 imagePath" });
    process.exit(1);
  }
  const worker = await createWorker(lang, 1, { logger: () => undefined });
  try {
    const { data } = await worker.recognize(imagePath);
    const text = (data?.text || "").trim();
    if (!text) {
      write({ ok: false, error: "Tesseract.js 识别结果为空" });
      process.exit(1);
    }
    write({ ok: true, text });
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

main().catch((err) => {
  write({ ok: false, error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
