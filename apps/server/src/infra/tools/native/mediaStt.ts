/**
 * 媒体下载 + 本地 STT（语音转文字）— 视频笔记 → 写文章。
 */
import fs from "fs";
import path from "path";
import { downloadMediaAudio, transcribeAudioFile, defaultSttInstallHint } from "../../localStt.js";
import { resolveAgentFsPath } from "./fs.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import { AGENT_TOOL_RESULT_MAX_CHARS } from "@knowpilot/shared";

function projectRel(ctx: NativeToolContext, abs: string): string {
  return path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/");
}

async function mediaDownloadTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`url 非法：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http/https");
  }

  const kind = String(args.kind || "audio").toLowerCase() === "video" ? "video" : "audio";
  if (kind === "video") {
    throw new Error(
      "v1 仅支持 kind=audio（抽音轨做 STT）。完整视频下载请用 yt-dlp 自行处理；笔记场景优先音频。",
    );
  }

  const slug =
    String(args.slug || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `media-${Date.now().toString(36)}`;

  const destRel = String(args.dest || `media/${slug}`)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const { abs: destAbs, relForReturn } = await resolveAgentFsPath(ctx, destRel, "write");
  fs.mkdirSync(destAbs, { recursive: true });
  const stemAbs = path.join(destAbs, "audio");

  const maxDurationSec =
    args.maxDurationSec !== undefined
      ? Number(args.maxDurationSec)
      : ctx.config.stt.maxDurationSec;

  const result = await downloadMediaAudio(ctx.config, url, stemAbs, { maxDurationSec });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      hint: result.hint,
      suggestedInstall: defaultSttInstallHint(),
    };
  }

  const audioRel = projectRel(ctx, result.audioPath);
  return {
    ok: true,
    kind: "audio",
    url,
    title: result.title,
    audioPath: audioRel,
    bytes: result.bytes,
    destDir: relForReturn,
    nextTool: "audio_transcribe",
    note: "已下载音轨。下一步 audio_transcribe({ path: audioPath })；长视频建议 async_task_run 后台跑。",
  };
}

async function audioTranscribeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const pathArg = String(args.path || "").trim();
  if (!pathArg) throw new Error("path 不能为空（media_download 返回的 audioPath）");

  const { abs, relForReturn } = await resolveAgentFsPath(ctx, pathArg, "read");
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${relForReturn}`);

  const outRel = String(args.outPath || "")
    .trim()
    .replace(/\\/g, "/");
  let outAbs: string;
  let outReturn: string;
  if (outRel) {
    const resolved = await resolveAgentFsPath(ctx, outRel, "write");
    outAbs = resolved.abs;
    outReturn = resolved.relForReturn;
  } else {
    outAbs = abs.replace(/\.[^.]+$/, "") + ".transcript.txt";
    outReturn = projectRel(ctx, outAbs);
  }

  const stt = await transcribeAudioFile(ctx.config, abs, outAbs, {
    model: args.model != null ? String(args.model) : undefined,
    language: args.language != null ? String(args.language) : undefined,
  });

  if (!stt.ok) {
    return {
      ok: false,
      error: stt.error,
      hint: stt.hint,
      audioPath: relForReturn,
      suggestedInstall: defaultSttInstallHint(),
    };
  }

  const maxChars = Math.min(
    AGENT_TOOL_RESULT_MAX_CHARS,
    Math.max(2000, Number(args.maxChars) || 12_000),
  );
  const full = fs.readFileSync(outAbs, "utf8");
  return {
    ok: true,
    engine: stt.engine,
    model: stt.model,
    language: stt.language,
    audioPath: relForReturn,
    transcriptPath: outReturn,
    chars: full.length,
    transcript: full.slice(0, maxChars),
    transcriptTruncated: full.length > maxChars,
    next: [
      "用 read_file 读 transcriptPath（可 offset 翻页）",
      "整理笔记后 post_create / 写入知识库",
    ],
    note: "本地 Whisper STT（非云 API）。全文在 transcriptPath。",
  };
}

/**
 * 一站式：视频 URL → 下音频 → STT → 返回逐字稿路径。
 * 长视频易超同步超时；Skill 会引导短片直调 / 长片 async_task_run。
 */
async function videoNotesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");

  const dl = (await mediaDownloadTool(
    {
      url,
      slug: args.slug,
      dest: args.dest,
      maxDurationSec: args.maxDurationSec,
    },
    ctx,
  )) as {
    ok?: boolean;
    error?: string;
    hint?: string;
    audioPath?: string;
    title?: string;
  };
  if (!dl.ok || !dl.audioPath) {
    return {
      ok: false,
      stage: "download",
      error: dl.error || "下载失败",
      hint: dl.hint || defaultSttInstallHint(),
    };
  }

  const tr = (await audioTranscribeTool(
    {
      path: dl.audioPath,
      model: args.model,
      language: args.language,
      maxChars: args.maxChars,
    },
    ctx,
  )) as Record<string, unknown>;

  return {
    ...tr,
    stage: tr.ok ? "done" : "transcribe",
    sourceUrl: url,
    title: dl.title,
    workflow: "media_download → audio_transcribe",
  };
}

const DEFS: NativeToolDefinition[] = [
  {
    name: "media_download",
    concurrencyClass: "C",
    description:
      "从视频/页面 URL 下载**音轨**到 Workspace（yt-dlp -x → mp3），供本地 Whisper 语音转文字。用于「无字幕视频做笔记」。需本机 yt-dlp + ffmpeg。长视频请 async_task_run 后台调用。默认最长 STT_MAX_DURATION_SEC（20 分钟）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "B 站 / YouTube / 其它 yt-dlp 支持的链接" },
        kind: { type: "string", enum: ["audio"], description: "v1 仅 audio" },
        dest: { type: "string", description: "Workspace 相对目录，默认 media/{slug}" },
        slug: { type: "string", description: "目录名片段" },
        maxDurationSec: { type: "number", description: "最长秒数，默认配置 1200" },
      },
      required: ["url"],
    },
  },
  {
    name: "audio_transcribe",
    concurrencyClass: "C",
    description:
      "本地语音转文字（STT，Whisper tiny/base，非 TTS）。输入 media_download 的 audioPath 或本地音频。写出 .transcript.txt，返回预览 + 路径；全文用 read_file。需 pip install faster-whisper。长音频建议 async_task_run。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "音频相对路径（mp3/wav/m4a）" },
        outPath: { type: "string", description: "可选逐字稿输出路径" },
        model: { type: "string", description: "默认 STT_WHISPER_MODEL=small；可改 tiny|base|small" },
        language: { type: "string", description: "zh|en|auto，默认 zh" },
        maxChars: { type: "number", description: "返回预览最大字符" },
      },
      required: ["path"],
    },
  },
  {
    name: "video_notes",
    concurrencyClass: "C",
    description:
      "视频链接一键做笔记材料：media_download（音轨）+ audio_transcribe（本地 Whisper）。有官方字幕时仍优先用 video_transcript。无字幕/字幕失败时用本工具。长视频务必 async_task_run。产出 transcriptPath 可 read_file 后 post_create 成文。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "视频 URL" },
        slug: { type: "string" },
        dest: { type: "string" },
        model: { type: "string", description: "Whisper 模型，默认 small" },
        language: { type: "string", description: "默认 zh" },
        maxDurationSec: { type: "number" },
        maxChars: { type: "number" },
      },
      required: ["url"],
    },
  },
];

const HANDLERS: Record<string, NativeToolHandler> = {
  media_download: mediaDownloadTool,
  audio_transcribe: audioTranscribeTool,
  video_notes: videoNotesTool,
};

export function registerMediaSttTools(): void {
  registerNativeDomain(DEFS, HANDLERS);
}
