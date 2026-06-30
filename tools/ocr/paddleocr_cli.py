#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PaddleOCR CLI - 供 Node.js 后端通过子进程调用

用法:
    python paddleocr_cli.py <image_path> [language]

输出: JSON 格式到 stdout
"""

import sys
import json
import time
import os

# Windows CPU 推理稳定性（Paddle 2.6 + 本地 PP-OCRv4 权重）
os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_use_onednn", "0")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# KnowPilot: tools/ocr/ → 项目根上两级
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(_script_dir))
_MODEL_BASE = os.environ.get("PPOCR_HOME") or os.path.join(_project_root, "weights", "ocr", "paddleocr")


def get_model_paths(lang="ch"):
    """返回 PaddleOCR 各模型目录路径"""
    if lang in ("ch", "cht"):
        return {
            "det": os.path.join(_MODEL_BASE, "whl", "det", "ch", "ch_PP-OCRv4_det_infer"),
            "rec": os.path.join(_MODEL_BASE, "whl", "rec", "ch", "ch_PP-OCRv4_rec_infer"),
            "cls": os.path.join(_MODEL_BASE, "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer"),
        }
    return {
        "det": os.path.join(_MODEL_BASE, "whl", "det", "en", "en_PP-OCRv3_det_infer"),
        "rec": os.path.join(_MODEL_BASE, "whl", "rec", "en", "en_PP-OCRv4_rec_infer"),
        "cls": os.path.join(_MODEL_BASE, "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer"),
    }


def _model_ready(model_dir):
    marker = os.path.join(model_dir, "inference.pdiparams")
    return os.path.isfile(marker)


def build_paddle_ocr(language, model_paths):
    from paddleocr import PaddleOCR

    kwargs = {
        "lang": language,
        "use_gpu": False,
        "show_log": False,
    }
    if _model_ready(model_paths["det"]):
        kwargs["det_model_dir"] = model_paths["det"]
    if _model_ready(model_paths["rec"]):
        kwargs["rec_model_dir"] = model_paths["rec"]
    use_cls = _model_ready(model_paths["cls"])
    if use_cls:
        kwargs["cls_model_dir"] = model_paths["cls"]
        kwargs["use_angle_cls"] = True
    else:
        kwargs["use_angle_cls"] = False
    return PaddleOCR(**kwargs), use_cls


def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python paddleocr_cli.py <image_path> [language]"
        }, ensure_ascii=False))
        sys.exit(1)

    image_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "ch"

    if not os.path.exists(image_path):
        print(json.dumps({
            "success": False,
            "error": f"File not found: {image_path}"
        }, ensure_ascii=False))
        sys.exit(1)

    model_paths = get_model_paths(language)
    start = time.time()
    try:
        cache_key = f"{language}:{model_paths['det']}:{model_paths['rec']}:{model_paths['cls']}"
        if not hasattr(main, "_ocr_cache"):
            main._ocr_cache = {}

        if cache_key not in main._ocr_cache:
            ocr, use_cls = build_paddle_ocr(language, model_paths)
            main._ocr_cache[cache_key] = (ocr, use_cls)
        else:
            ocr, use_cls = main._ocr_cache[cache_key]

        result = ocr.ocr(image_path, cls=use_cls)

        lines = []
        if result and result[0]:
            for line in result[0]:
                text, confidence = line[1]
                lines.append({
                    "text": text,
                    "confidence": round(float(confidence), 4)
                })

        full_text = "\n".join([l["text"] for l in lines])
        elapsed = time.time() - start

        print(json.dumps({
            "success": True,
            "data": {
                "text": full_text,
                "lines": lines,
                "engine": "PaddleOCR",
                "language": language,
                "elapsed_ms": round(elapsed * 1000, 1)
            }
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
