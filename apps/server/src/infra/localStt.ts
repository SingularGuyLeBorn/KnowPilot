/**
 * 本地语音转文字（STT）— 轻量 Whisper（faster-whisper / openai-whisper CLI 脚本）。
 * 不是 TTS。供 media_download → audio_transcribe → 写文章链路使用。
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AppConfig } from "./config.js";

const SCRIPT_REL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "whisper_transcribe.py",
);

export type SttResult = {
  ok: true;
  engine: string;
  model: string;
  language: string;
  chars: number;
  transcriptPath: string;
  transcript: string;
  transcriptTruncated: boolean;
};

export type SttFail = {
  ok: false;
  error: string;
  hint: string;
};

function runCmd(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, opts.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function resolvePythonBin(config: AppConfig): Promise<string> {
  const fromStt = config.stt.pythonPath?.trim();
  if (fromStt) return fromStt;
  const fromOcr = config.ocr.paddlePythonPath?.trim();
  if (fromOcr) return fromOcr;
  // 项目根 .venv（uv venv）优先于系统 Python
  const venvPy =
    process.platform === "win32"
      ? path.join(config.projectRoot, ".venv", "Scripts", "python.exe")
      : path.join(config.projectRoot, ".venv", "bin", "python");
  if (fs.existsSync(venvPy)) return venvPy;
  if (process.platform === "win32") return "python";
  return "python3";
}

export function defaultSttInstallHint(): string {
  return [
    "本机安装（一次）：",
    "  pip install -U faster-whisper yt-dlp",
    "  # 还需 ffmpeg 在 PATH（winget install Gyan.FFmpeg 或 choco install ffmpeg）",
    "可选：.env 设 STT_PYTHON_PATH / STT_WHISPER_MODEL=small / STT_LANGUAGE=zh",
    "长视频请用 async_task_run 后台跑，避免同步工具 30s 超时。",
  ].join("\n");
}

/** 对本地音频文件跑 Whisper STT，写出 transcript .txt */
export async function transcribeAudioFile(
  config: AppConfig,
  audioAbs: string,
  outTxtAbs: string,
  opts?: { model?: string; language?: string; timeoutMs?: number },
): Promise<SttResult | SttFail> {
  if (!fs.existsSync(audioAbs)) {
    return { ok: false, error: `音频不存在：${audioAbs}`, hint: defaultSttInstallHint() };
  }
  const script = config.stt.scriptPath?.trim() || SCRIPT_REL;
  if (!fs.existsSync(script)) {
    return { ok: false, error: `缺少脚本：${script}`, hint: defaultSttInstallHint() };
  }

  const model = (opts?.model || config.stt.whisperModel || "small").trim();
  const language = (opts?.language || config.stt.language || "zh").trim();
  const timeoutMs = Math.max(
    30_000,
    opts?.timeoutMs ?? config.stt.timeoutMs ?? 600_000,
  );
  const python = await resolvePythonBin(config);
  const metaAbs = `${outTxtAbs}.meta.json`;
  fs.mkdirSync(path.dirname(outTxtAbs), { recursive: true });

  // 权重默认落项目 weights/hf（与 PPOCR_HOME=weights/ocr/paddleocr 并列）；镜像用 HF_ENDPOINT。
  // 优先项目 weights/hf；若本机设了 HUGGINGFACE_HUB_CACHE（如 D:\DevCache\...）会盖过 HF_HOME，这里一并钉死。
  const hfHome =
    process.env.HF_HOME?.trim() || path.join(config.projectRoot, "weights", "hf");
  const hfHub = path.join(hfHome, "hub");
  fs.mkdirSync(hfHub, { recursive: true });
  const { code, stdout, stderr } = await runCmd(
    python,
    [
      script,
      "--audio",
      audioAbs,
      "--out",
      outTxtAbs,
      "--model",
      model,
      "--language",
      language,
      "--meta",
      metaAbs,
    ],
    {
      timeoutMs,
      env: {
        HF_HOME: hfHome,
        HUGGINGFACE_HUB_CACHE: hfHub,
        HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
        HF_HUB_DISABLE_SYMLINKS_WARNING: process.env.HF_HUB_DISABLE_SYMLINKS_WARNING || "1",
      } as unknown as NodeJS.ProcessEnv,
    },
  );

  let parsed: Record<string, unknown> | null = null;
  try {
    const line = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    if (line) parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (code !== 0 || !parsed?.ok) {
    const err = String(
      parsed?.error || stderr.trim() || stdout.trim() || `whisper 退出码 ${code}`,
    );
    return {
      ok: false,
      error: err.slice(0, 2000),
      hint: String(parsed?.hint || defaultSttInstallHint()),
    };
  }

  const transcript = fs.existsSync(outTxtAbs) ? fs.readFileSync(outTxtAbs, "utf8") : "";
  const maxPreview = 12_000;
  return {
    ok: true,
    engine: String(parsed.engine || "whisper"),
    model,
    language,
    chars: transcript.length,
    transcriptPath: outTxtAbs,
    transcript: transcript.slice(0, maxPreview),
    transcriptTruncated: transcript.length > maxPreview,
  };
}

export async function resolveYtDlpBin(config: AppConfig): Promise<string> {
  const configured = config.stt.ytDlpPath?.trim();
  if (configured) return configured;
  const venvYt =
    process.platform === "win32"
      ? path.join(config.projectRoot, ".venv", "Scripts", "yt-dlp.exe")
      : path.join(config.projectRoot, ".venv", "bin", "yt-dlp");
  if (fs.existsSync(venvYt)) return venvYt;
  return "yt-dlp";
}

/** 用 yt-dlp 抽音频到目标文件（无扩展名模板由调用方给 stem） */
export async function downloadMediaAudio(
  config: AppConfig,
  url: string,
  outStemAbs: string,
  opts?: { timeoutMs?: number; maxDurationSec?: number },
): Promise<
  | { ok: true; audioPath: string; title?: string; bytes: number }
  | { ok: false; error: string; hint: string }
> {
  const yt = await resolveYtDlpBin(config);
  const timeoutMs = Math.max(30_000, opts?.timeoutMs ?? config.stt.downloadTimeoutMs ?? 600_000);
  const maxDur = opts?.maxDurationSec ?? config.stt.maxDurationSec ?? 1200;
  fs.mkdirSync(path.dirname(outStemAbs), { recursive: true });

  // 输出模板：stem.%(ext)s → 我们强制 mp3
  const outTpl = `${outStemAbs}.%(ext)s`;
  const args = [
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "--no-playlist",
    "--newline",
    "-o",
    outTpl,
    "--match-filter",
    `duration <= ${maxDur}`,
    "--print",
    "after_move:filepath",
    "--print",
    "title",
    url,
  ];

  const { code, stdout, stderr } = await runCmd(yt, args, { timeoutMs });
  if (code !== 0) {
    const msg = (stderr || stdout || `yt-dlp 退出码 ${code}`).slice(0, 2000);
    const hint = [
      defaultSttInstallHint(),
      "若提示 duration：视频超过 STT_MAX_DURATION_SEC（默认 20 分钟），请缩短或调高上限。",
    ].join("\n");
    return { ok: false, error: msg, hint };
  }

  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // 最后两行通常是 filepath / title（--print 顺序）
  let audioPath = `${outStemAbs}.mp3`;
  let title: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!title && !/[\\/]/.test(line) && !line.endsWith(".mp3")) {
      title = line;
      continue;
    }
    if (fs.existsSync(line)) {
      audioPath = line;
      break;
    }
  }
  if (!fs.existsSync(audioPath)) {
    // 扫描目录
    const dir = path.dirname(outStemAbs);
    const base = path.basename(outStemAbs);
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(base) && /\.(mp3|m4a|wav|webm)$/i.test(f));
    if (hit) audioPath = path.join(dir, hit);
  }
  if (!fs.existsSync(audioPath)) {
    return {
      ok: false,
      error: `下载完成但未找到音频文件（stdout: ${stdout.slice(0, 400)}）`,
      hint: defaultSttInstallHint(),
    };
  }
  return {
    ok: true,
    audioPath,
    title,
    bytes: fs.statSync(audioPath).size,
  };
}
