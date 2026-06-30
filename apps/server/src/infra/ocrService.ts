/**
 * 图片 OCR — 对齐 MetaBlog：PaddleOCR（百度 Paddle 本地模型）→ OCR.space 云端降级
 * Chat 非多模态模型发图时，将识别文字拼入 user 消息。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import type { AppConfig } from "./config.js";

export interface OcrPerformResult {
  text: string;
  engine: string;
  success: boolean;
  error?: string;
}

const PADDLE_LANG_MAP: Record<string, string> = {
  auto: "ch",
  chs: "ch",
  cht: "ch",
  en: "en",
  jpn: "japan",
  kor: "korean",
};

const OCR_SPACE_LANG_MAP: Record<string, string> = {
  auto: "chs",
  chs: "chs",
  cht: "cht",
  en: "eng",
  jpn: "jpn",
  kor: "kor",
};

function resolvePaddleDefaults(projectRoot: string) {
  return {
    cli: path.join(projectRoot, "tools", "ocr", "paddleocr_cli.py"),
    python: process.platform === "win32" ? "" : "python3",
    ppocrHome: path.join(projectRoot, "weights", "ocr", "paddleocr"),
  };
}

function pythonPathExists(cmd: string): boolean {
  if (!cmd) return false;
  if (cmd.includes("/") || cmd.includes("\\") || /^[a-zA-Z]:/.test(cmd)) {
    return fs.existsSync(cmd);
  }
  return true;
}

function paddleSpawnEnv(config: AppConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PPOCR_HOME: config.ocr.ppocrHome,
    FLAGS_use_mkldnn: "0",
    FLAGS_use_onednn: "0",
    KMP_DUPLICATE_LIB_OK: "TRUE",
    PYTHONIOENCODING: "utf-8",
  };
}

function launcherLabel(launcher: { cmd: string; prefix: string[] }): string {
  return launcher.prefix.length ? `${launcher.cmd} ${launcher.prefix.join(" ")}` : launcher.cmd;
}

function probeLauncher(
  config: AppConfig,
  launcher: { cmd: string; prefix: string[] },
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(launcher.cmd, [...launcher.prefix, "-c", "from paddleocr import PaddleOCR"], {
      env: paddleSpawnEnv(config),
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ ok: false, error: "import 超时(20s)" });
    }, 20_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.slice(0, 240) || `exit ${code}` });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

/** 探测首个可用的 Paddle Python 解释器 */
export async function probeOcrPython(config: AppConfig) {
  for (const launcher of paddlePythonLaunchers(config)) {
    const label = launcherLabel(launcher);
    const result = await probeLauncher(config, launcher);
    if (result.ok) return { launcher: label, paddleImportOk: true as const };
  }
  return {
    launcher: "",
    paddleImportOk: false as const,
    error: "无可用 Python 或未安装 paddleocr 2.9.x + paddlepaddle 2.6.x（见 tools/ocr/requirements.txt）",
  };
}

function paddlePythonLaunchers(config: AppConfig): Array<{ cmd: string; prefix: string[] }> {
  const launchers: Array<{ cmd: string; prefix: string[] }> = [];
  const push = (cmd: string, prefix: string[] = []) => {
    if (!cmd || !pythonPathExists(cmd)) return;
    if (launchers.some((l) => l.cmd === cmd && l.prefix.join() === prefix.join())) return;
    launchers.push({ cmd, prefix });
  };

  push(config.ocr.paddlePythonPath);
  if (process.platform === "win32") {
    push("py", ["-3.10"]);
    push("py", ["-3.11"]);
    push("C:\\Program Files\\Python310\\python.exe");
    push("C:\\Program Files\\Python311\\python.exe");
  }
  push("python3");
  push("python");
  return launchers;
}

function runPaddleOnce(
  config: AppConfig,
  launcher: { cmd: string; prefix: string[] },
  cli: string,
  imagePath: string,
  paddleLang: string,
): Promise<OcrPerformResult> {
  return new Promise((resolve) => {
    const proc = spawn(launcher.cmd, [...launcher.prefix, cli, imagePath, paddleLang], {
      env: paddleSpawnEnv(config),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ text: "", engine: "PaddleOCR", success: false, error: "PaddleOCR 识别超时(30s)" });
    }, 30_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          text: "",
          engine: "PaddleOCR",
          success: false,
          error: `PaddleOCR 失败 (${launcher.cmd} exit ${code}): ${stderr.slice(0, 300)}`,
        });
        return;
      }
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : stdout.trim()) as {
          success?: boolean;
          error?: string;
          data?: { text?: string };
        };
        if (!parsed.success) {
          resolve({
            text: "",
            engine: "PaddleOCR",
            success: false,
            error: parsed.error || "PaddleOCR 未返回文本",
          });
          return;
        }
        const text = parsed.data?.text?.trim() || "";
        if (!text) {
          resolve({ text: "", engine: "PaddleOCR", success: false, error: "PaddleOCR 识别结果为空" });
          return;
        }
        resolve({ text, engine: "PaddleOCR", success: true });
      } catch (err: unknown) {
        resolve({
          text: "",
          engine: "PaddleOCR",
          success: false,
          error: `PaddleOCR 输出解析失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ text: "", engine: "PaddleOCR", success: false, error: `PaddleOCR 进程启动失败 (${launcher.cmd}): ${err.message}` });
    });
  });
}

async function ocrWithPaddleOCR(
  config: AppConfig,
  imagePath: string,
  language: string,
): Promise<OcrPerformResult> {
  const cli = config.ocr.paddleCliPath;
  if (!fs.existsSync(cli)) {
    return {
      text: "",
      engine: "PaddleOCR",
      success: false,
      error: `PaddleOCR CLI 未找到: ${cli}（运行 pnpm ocr:copy 从 MetaBlog 复制脚本与权重）`,
    };
  }

  const paddleLang = PADDLE_LANG_MAP[language] || "ch";
  const errors: string[] = [];

  for (const launcher of paddlePythonLaunchers(config)) {
    const result = await runPaddleOnce(config, launcher, cli, imagePath, paddleLang);
    if (result.success && result.text) return result;
    if (result.error) errors.push(result.error);
  }

  return {
    text: "",
    engine: "PaddleOCR",
    success: false,
    error: errors.join("\n") || "PaddleOCR 无可用 Python 解释器",
  };
}

async function ocrWithOcrSpace(
  config: AppConfig,
  imagePath: string,
  language: string,
): Promise<OcrPerformResult> {
  const apiKey = config.ocr.ocrSpaceApiKey;
  if (!apiKey) {
    return { text: "", engine: "OCR.space", success: false, error: "未配置 OCR_SPACE_API_KEY" };
  }

  const buffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), path.basename(imagePath));
  form.append("language", OCR_SPACE_LANG_MAP[language] || config.ocr.ocrSpaceDefaultLang);
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");

  try {
    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        text: "",
        engine: "OCR.space",
        success: false,
        error: `OCR.space HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      };
    }
    const data = (await res.json()) as {
      OCRExitCode?: number;
      ErrorMessage?: string[];
      ErrorDetails?: string;
      ParsedResults?: Array<{ ParsedText?: string }>;
    };
    if (data.OCRExitCode !== 1) {
      const msg = data.ErrorMessage?.join(", ") || data.ErrorDetails || "Unknown error";
      return { text: "", engine: "OCR.space", success: false, error: `OCR.space: ${msg}` };
    }
    const text = (data.ParsedResults || []).map((r) => r.ParsedText || "").join("\n\n").trim();
    if (!text) return { text: "", engine: "OCR.space", success: false, error: "OCR.space 未返回文本" };
    return { text, engine: "OCR.space", success: true };
  } catch (err: unknown) {
    return {
      text: "",
      engine: "OCR.space",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function modelReady(modelDir: string): boolean {
  return fs.existsSync(path.join(modelDir, "inference.pdiparams"));
}

/** OCR 诊断信息（integration:smoke / 调试） */
export function getOcrStatus(config: AppConfig) {
  const ppocrHome = config.ocr.ppocrHome;
  const det = path.join(ppocrHome, "whl", "det", "ch", "ch_PP-OCRv4_det_infer");
  const rec = path.join(ppocrHome, "whl", "rec", "ch", "ch_PP-OCRv4_rec_infer");
  const cls = path.join(ppocrHome, "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer");
  const launchers = paddlePythonLaunchers(config).map((l) =>
    l.prefix.length ? `${l.cmd} ${l.prefix.join(" ")}` : l.cmd,
  );

  return {
    paddleCli: fs.existsSync(config.ocr.paddleCliPath),
    ppocrHome,
    models: { det: modelReady(det), rec: modelReady(rec), cls: modelReady(cls) },
    pythonLaunchers: launchers,
    ocrSpaceConfigured: !!config.ocr.ocrSpaceApiKey,
  };
}

/** 写入临时文件后按 MetaBlog 顺序降级识别 */
export async function performOcrFromFile(
  config: AppConfig,
  imagePath: string,
  language = "auto",
): Promise<OcrPerformResult> {
  if (!fs.existsSync(imagePath)) {
    return { text: "", engine: "none", success: false, error: `文件不存在: ${imagePath}` };
  }
  const stats = fs.statSync(imagePath);
  if (!stats.isFile()) {
    return { text: "", engine: "none", success: false, error: "不是有效文件" };
  }
  if (stats.size > 10 * 1024 * 1024) {
    return { text: "", engine: "none", success: false, error: "图片超过 10MB 上限" };
  }

  const engines: Array<{ name: string; fn: () => Promise<OcrPerformResult> }> = [
    { name: "PaddleOCR", fn: () => ocrWithPaddleOCR(config, imagePath, language) },
    { name: "OCR.space", fn: () => ocrWithOcrSpace(config, imagePath, language) },
  ];

  const errors: string[] = [];
  for (const engine of engines) {
    const result = await engine.fn();
    if (result.success && result.text) return result;
    if (result.error) errors.push(`${engine.name}: ${result.error}`);
  }

  return {
    text: "",
    engine: "none",
    success: false,
    error: `所有 OCR 引擎均失败。\n${errors.join("\n")}`,
  };
}

export async function extractTextFromImage(
  config: AppConfig,
  opts: {
    base64: string;
    mimeType: string;
    language?: string;
    /** 保留兼容；Chat OCR 始终走本地/云端 OCR 引擎，不走 LLM 识图 */
    chatSupportsVision?: boolean;
    visionModelId?: string;
  },
): Promise<{ text: string; source: "ocr" | "vision"; engine?: string }> {
  const mime = opts.mimeType || "image/png";
  const raw = opts.base64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");

  const ext =
    mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : mime.includes("gif") ? ".gif" : ".jpg";
  const tempPath = path.join(os.tmpdir(), `kp-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);

  try {
    fs.writeFileSync(tempPath, buffer);
    const result = await performOcrFromFile(config, tempPath, opts.language || "auto");
    if (!result.success || !result.text) {
      throw new Error(result.error || "OCR 未返回文本");
    }
    return { text: result.text, source: "ocr", engine: result.engine };
  } finally {
    fs.unlink(tempPath, () => undefined);
  }
}
