import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeNativeTool } from "../infra/nativeTools.js";
import * as localStt from "../infra/localStt.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";

describe("media STT tools", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "data/workspace"), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("audio_transcribe 写出逐字稿并返回预览", async () => {
    const audioRel = "media/demo/audio.mp3";
    const audioAbs = path.join(root, "data/workspace", audioRel);
    fs.mkdirSync(path.dirname(audioAbs), { recursive: true });
    fs.writeFileSync(audioAbs, Buffer.from("fake-mp3"));

    vi.spyOn(localStt, "transcribeAudioFile").mockImplementation(async (_cfg, _a, outTxt) => {
      fs.mkdirSync(path.dirname(outTxt), { recursive: true });
      fs.writeFileSync(outTxt, "你好，这是本地 Whisper 转写结果。\n", "utf8");
      return {
        ok: true,
        engine: "faster-whisper",
        model: "tiny",
        language: "zh",
        chars: 20,
        transcriptPath: outTxt,
        transcript: "你好，这是本地 Whisper 转写结果。",
        transcriptTruncated: false,
      };
    });

    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "audio_transcribe",
      { path: audioRel },
      ctx,
    )) as {
      ok: boolean;
      transcriptPath: string;
      transcript: string;
      engine: string;
    };

    expect(result.ok).toBe(true);
    expect(result.engine).toBe("faster-whisper");
    expect(result.transcript).toContain("Whisper");
    expect(fs.existsSync(path.join(root, result.transcriptPath.replace(/\//g, path.sep)))).toBe(
      true,
    );
  });

  it("media_download 失败时返回安装提示", async () => {
    vi.spyOn(localStt, "downloadMediaAudio").mockResolvedValue({
      ok: false,
      error: "yt-dlp not found",
      hint: localStt.defaultSttInstallHint(),
    });
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "media_download",
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      ctx,
    )) as { ok: boolean; suggestedInstall: string };

    expect(result.ok).toBe(false);
    expect(result.suggestedInstall).toContain("faster-whisper");
  });
});
