---
name: video-notes
description: 视频链接做笔记：优先字幕，否则本地下音频 + Whisper STT，再整理成文章
kind: procedural
enabled: true
version: "0.1.0"
author: KnowPilot
---

# video-notes — 视频 → 逐字稿 → 文章

用户场景：扔一个视频链接 → 做笔记 → 可写成知识库文章。  
这是 **STT（语音转文字）**，不是 TTS。

先 `skill_view(name="video-notes")`。

## 流程（理想）

1. **先试官方字幕（快、准）**  
   `video_transcript({ url })`  
   - 有 `transcript` → 直接整理笔记 / `post_create`。  
   - 空或 note 提示无字幕 → 走本地 STT。

2. **本地 STT（无字幕）**  
   - 短片（≤约 10～15 分钟）：`video_notes({ url })` 一站式。  
   - 长片：`async_task_run` 后台跑 `video_notes` 或分步：  
     `media_download` → `audio_transcribe` → 投递回来再读。  
   - 全文在 `transcriptPath`，用 `read_file`（可 offset）读取，**不要**指望工具预览里塞全书。

3. **成文**  
   用户确认后 `post_create` / Chat「写入知识库」。保留来源 URL。

## 本机依赖（一次）

```text
pip install -U faster-whisper yt-dlp
# ffmpeg 在 PATH（Windows: winget install Gyan.FFmpeg）
```

可选 `.env`：`STT_PYTHON_PATH`、`STT_WHISPER_MODEL=tiny`、`STT_LANGUAGE=zh`。

## 工具

| 工具 | 用途 |
|------|------|
| `video_transcript` | B 站 / YouTube 官方字幕 |
| `media_download` | yt-dlp 抽 mp3 |
| `audio_transcribe` | 本地 Whisper → `.transcript.txt` |
| `video_notes` | 下载+转写一站式 |
| `read_file` | 读全文逐字稿 |
| `post_create` | 落花园 |

## 超时注意

同步工具默认约 30s（`AGENT_TOOL_CALL_TIMEOUT_MS`）。Whisper 转长音频会超时 → **用 `async_task_run`**，或临时加大超时。默认下载上限 `STT_MAX_DURATION_SEC=1200`（20 分钟）。

## 反模式

- 无字幕时反复 `video_transcript` 死磕  
- 把整段逐字稿糊进多轮对话不落 `transcriptPath`  
- `write_file` 直写 `content/` 文章（应 `post_*`）
