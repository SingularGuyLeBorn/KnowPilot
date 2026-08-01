#!/usr/bin/env python3
"""KnowPilot 本地语音转文字（STT）。

优先 faster-whisper（CTranslate2，轻量）；否则回退 openai-whisper。
用法：
  python whisper_transcribe.py --audio in.mp3 --out out.txt --model tiny --language zh
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def transcribe_faster(audio: Path, model: str, language: str | None) -> str:
    from faster_whisper import WhisperModel

    # tiny/base 用 int8 更省内存；CPU 友好
    wm = WhisperModel(model, device="cpu", compute_type="int8")
    lang = None if not language or language in ("auto", "detect") else language
    segments, _info = wm.transcribe(str(audio), language=lang, vad_filter=True)
    parts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
    return "\n".join(parts).strip()


def transcribe_openai(audio: Path, model: str, language: str | None) -> str:
    import whisper

    wm = whisper.load_model(model)
    lang = None if not language or language in ("auto", "detect") else language
    # openai-whisper 用 Chinese / english 全名也可；zh 通常可用
    result = wm.transcribe(str(audio), language=lang, fp16=False)
    return str(result.get("text") or "").strip()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="tiny")
    p.add_argument("--language", default="zh")
    p.add_argument("--meta", default="")
    args = p.parse_args()

    audio = Path(args.audio)
    out = Path(args.out)
    if not audio.is_file():
        print(json.dumps({"ok": False, "error": f"audio not found: {audio}"}, ensure_ascii=False))
        return 2

    engine = ""
    text = ""
    err = ""
    try:
        text = transcribe_faster(audio, args.model, args.language)
        engine = "faster-whisper"
    except Exception as e1:  # noqa: BLE001 — 探测式回退
        err = f"faster-whisper: {e1}"
        try:
            text = transcribe_openai(audio, args.model, args.language)
            engine = "openai-whisper"
            err = ""
        except Exception as e2:  # noqa: BLE001
            err = f"{err}; openai-whisper: {e2}"
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": err,
                        "hint": "pip install -U faster-whisper  （推荐）或 pip install -U openai-whisper；并确保已装 ffmpeg",
                    },
                    ensure_ascii=False,
                )
            )
            return 3

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + ("\n" if text else ""), encoding="utf-8")
    meta = {
        "ok": True,
        "engine": engine,
        "model": args.model,
        "language": args.language,
        "chars": len(text),
        "out": str(out),
    }
    if args.meta:
        Path(args.meta).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
