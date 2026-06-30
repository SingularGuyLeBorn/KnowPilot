#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PaddleOCR ZIP 批量识别服务 — 多线程版本

每个线程独立负责一个输出文件（按 ZIP 内目录分组）。
边处理边写入，中途中断也能保留已完成的文件。

用法:
    python batch_ocr_zip_threaded.py <zip_path> [output_dir] [options]

依赖安装:
    pip install paddleocr paddlepaddle
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ==================== 模型路径配置 ====================

_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(_script_dir)))
_MODEL_BASE = os.path.join(_project_root, "weights", "ocr", "paddleocr")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}
DEFAULT_THREADS = 4                         # 每个线程一个 PaddleOCR 实例，太多会爆内存
DEFAULT_CONFIDENCE = 0.7                    # 文字行置信度阈值
IMAGES_PER_MD = 200                         # 单个 MD 文件最大图片数


def get_model_paths(lang="ch"):
    """返回 PaddleOCR 各模型目录路径"""
    if lang in ("ch", "cht"):
        return {
            "det": os.path.join(_MODEL_BASE, "whl", "det", "ch", "ch_PP-OCRv4_det_infer"),
            "rec": os.path.join(_MODEL_BASE, "whl", "rec", "ch", "ch_PP-OCRv4_rec_infer"),
            "cls": os.path.join(_MODEL_BASE, "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer"),
        }
    else:
        return {
            "det": os.path.join(_MODEL_BASE, "whl", "det", "en", "en_PP-OCRv3_det_infer"),
            "rec": os.path.join(_MODEL_BASE, "whl", "rec", "en", "en_PP-OCRv4_rec_infer"),
            "cls": os.path.join(_MODEL_BASE, "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer"),
        }


def create_ocr_instance(lang="ch"):
    """创建 PaddleOCR 实例"""
    from paddleocr import PaddleOCR
    model_paths = get_model_paths(lang)
    return PaddleOCR(
        lang=lang,
        use_gpu=False,
        show_log=False,
        enable_mkldnn=True,
        det_model_dir=model_paths["det"],
        rec_model_dir=model_paths["rec"],
        cls_model_dir=model_paths["cls"],
    )


def ocr_single_image(ocr_instance, image_path: str, base_dir: str) -> dict:
    """单张图片 OCR"""
    start = time.time()
    try:
        result = ocr_instance.ocr(image_path, cls=False)

        lines = []
        if result and result[0]:
            for line in result[0]:
                text, confidence = line[1]
                if float(confidence) >= DEFAULT_CONFIDENCE:
                    lines.append(text)

        full_text = "\n".join(lines).strip()
        elapsed_ms = round((time.time() - start) * 1000, 1)
        rel_path = os.path.relpath(image_path, base_dir)

        return {
            "rel_path": rel_path,
            "text": full_text,
            "lines": len(lines),
            "elapsed_ms": elapsed_ms,
            "has_text": len(full_text) > 0,
        }

    except Exception as e:
        return {
            "rel_path": os.path.relpath(image_path, base_dir),
            "text": "",
            "lines": 0,
            "elapsed_ms": 0,
            "has_text": False,
            "error": str(e),
        }


def extract_zip(zip_path: str, extract_dir: str) -> list:
    """解压 ZIP 并返回所有图片路径"""
    print(f"[1/5] 正在解压: {zip_path}")
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"ZIP 文件不存在: {zip_path}")

    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.namelist():
            member_path = os.path.join(extract_dir, member)
            if not os.path.commonprefix([extract_dir, member_path]).startswith(extract_dir):
                raise ValueError(f"ZIP 包含非法路径: {member}")
        zf.extractall(extract_dir)

    image_paths = []
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if Path(f).suffix.lower() in IMAGE_EXTS:
                image_paths.append(os.path.join(root, f))

    image_paths.sort()
    print(f"[1/5] 解压完成，共发现 {len(image_paths)} 张图片")
    return image_paths


def group_images_by_dir(image_paths: list, base_dir: str) -> dict:
    """按目录分组图片"""
    groups = defaultdict(list)
    for path in image_paths:
        rel = os.path.relpath(path, base_dir)
        dir_name = os.path.dirname(rel)
        if not dir_name:
            dir_name = "root"
        groups[dir_name].append(path)
    return dict(groups)


def process_one_group(
    group_name: str,
    image_paths: list,
    base_dir: str,
    output_dir: str,
    lang: str,
    group_idx: int,
    total_groups: int,
) -> dict:
    """
    单个线程：处理一个目录组的图片，边处理边写入临时 MD 文件。
    """
    thread_start = time.time()
    ocr_instance = create_ocr_instance(lang)
    results = []

    # 临时文件（边处理边写）
    tmp_path = os.path.join(output_dir, f".{group_name}.tmp.md")
    final_path = os.path.join(output_dir, f"{group_name}.md")

    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(f"# {group_name}\n\n")
        f.write(f"> 共 {len(image_paths)} 张图片\n\n")

        for i, img_path in enumerate(image_paths, 1):
            result = ocr_single_image(ocr_instance, img_path, base_dir)
            results.append(result)

            # 边处理边写入
            f.write(f"## {i}. `{result['rel_path']}`\n\n")
            if result["text"]:
                text = result["text"].replace("|", "\\|").replace("\n", "\n\n")
                f.write(f"{text}\n\n")
            else:
                f.write("_（未识别到文字）_\n\n")
            f.write("---\n\n")
            f.flush()  # 立即刷盘

    # 处理完成，重命名为最终文件
    shutil.move(tmp_path, final_path)

    elapsed = time.time() - thread_start
    valid = sum(1 for r in results if r["has_text"])
    print(f"  [线程 {group_idx+1}/{total_groups}] {group_name}: {len(image_paths)} 张 | "
          f"有效 {valid} | 耗时 {elapsed:.1f}s")

    return {
        "group": group_name,
        "total": len(image_paths),
        "valid": valid,
        "empty": len(image_paths) - valid,
        "errors": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def write_summary(output_dir: str, zip_name: str, group_stats: list):
    """写入汇总文件"""
    summary_path = os.path.join(output_dir, "_summary.md")
    total = sum(s["total"] for s in group_stats)
    valid = sum(s["valid"] for s in group_stats)
    empty = sum(s["empty"] for s in group_stats)
    errors = sum(s["errors"] for s in group_stats)

    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"# OCR 识别结果汇总\n\n")
        f.write(f"- **来源 ZIP**: `{zip_name}`\n")
        f.write(f"- **输出时间**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- **总图片数**: {total}\n")
        f.write(f"- **识别成功（有文字）**: {valid}\n")
        f.write(f"- **无文字**: {empty}\n")
        f.write(f"- **识别失败**: {errors}\n\n")
        f.write("## 文件清单\n\n")
        for s in sorted(group_stats, key=lambda x: x["group"]):
            f.write(f"- [{s['group']}.md]({s['group']}.md) — "
                    f"{s['total']} 张（有效 {s['valid']}）\n")
        f.write("\n")

    print(f"[4/5] 汇总文件: {summary_path}")


def write_json_results(results: list, output_dir: str):
    """可选：写入完整 JSON 结果"""
    json_path = os.path.join(output_dir, "_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"[5/5] 完整 JSON 结果已保存: {json_path}")


def main():
    parser = argparse.ArgumentParser(description="PaddleOCR ZIP 批量识别服务 — 多线程版")
    parser.add_argument("zip_path", help="输入 ZIP 文件路径")
    parser.add_argument("output_dir", nargs="?", default=None, help="输出目录（默认: ZIP同名目录）")
    parser.add_argument("--threads", "-t", type=int, default=DEFAULT_THREADS,
                        help=f"线程数（默认: {DEFAULT_THREADS}，每个线程独立一个 PaddleOCR 实例）")
    parser.add_argument("--lang", "-l", default="ch", help="语言: ch/en/japan/korean（默认: ch）")
    parser.add_argument("--no-json", action="store_true", help="不输出 JSON 结果文件")

    args = parser.parse_args()

    zip_path = os.path.abspath(args.zip_path)
    if args.output_dir:
        output_dir = os.path.abspath(args.output_dir)
    else:
        output_dir = os.path.splitext(zip_path)[0] + "_ocr"

    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("PaddleOCR ZIP 批量识别服务 — 多线程版")
    print("=" * 60)
    print(f"ZIP 文件: {zip_path}")
    print(f"输出目录: {output_dir}")
    print(f"线程数: {args.threads}")
    print(f"语言: {args.lang}")
    print("=" * 60)

    # 创建临时解压目录
    extract_dir = tempfile.mkdtemp(prefix="paddleocr_extract_")

    try:
        # 1. 解压
        image_paths = extract_zip(zip_path, extract_dir)
        if not image_paths:
            print("[错误] ZIP 中未找到图片文件")
            sys.exit(1)

        # 2. 按目录分组
        groups = group_images_by_dir(image_paths, extract_dir)
        print(f"[2/5] 按目录分组: {len(groups)} 组")
        for name, paths in sorted(groups.items()):
            print(f"  - {name}: {len(paths)} 张")

        # 3. 多线程处理（每组一个线程）
        print(f"[3/5] 启动多线程处理（{min(args.threads, len(groups))} 线程并行）")
        group_stats = []
        all_results = []

        start_total = time.time()

        with ThreadPoolExecutor(max_workers=args.threads) as executor:
            futures = {}
            group_items = list(groups.items())
            total_groups = len(group_items)

            for idx, (group_name, paths) in enumerate(group_items):
                future = executor.submit(
                    process_one_group,
                    group_name,
                    paths,
                    extract_dir,
                    output_dir,
                    args.lang,
                    idx,
                    total_groups,
                )
                futures[future] = group_name

            for future in as_completed(futures):
                try:
                    stat = future.result()
                    group_stats.append(stat)
                    all_results.extend(stat["results"])
                except Exception as e:
                    group_name = futures[future]
                    print(f"  [错误] 线程 {group_name} 失败: {e}")

        total_elapsed = time.time() - start_total
        print(f"[3/5] 全部完成，总耗时 {total_elapsed:.1f}s")

        # 4. 写入汇总
        zip_name = os.path.basename(zip_path)
        write_summary(output_dir, zip_name, group_stats)

        # 5. 输出 JSON（可选）
        if not args.no_json:
            write_json_results(all_results, output_dir)

        # 最终统计
        total = sum(s["total"] for s in group_stats)
        valid = sum(s["valid"] for s in group_stats)
        empty = sum(s["empty"] for s in group_stats)
        errors = sum(s["errors"] for s in group_stats)

        print("\n" + "=" * 60)
        print("处理完成")
        print("=" * 60)
        print(f"总图片数: {total}")
        print(f"识别成功（有文字）: {valid}")
        print(f"无文字: {empty}")
        print(f"识别失败: {errors}")
        print(f"输出分组: {len(group_stats)}")
        print(f"输出目录: {output_dir}")
        print("=" * 60)

    finally:
        if os.path.exists(extract_dir):
            shutil.rmtree(extract_dir)
            print(f"[清理] 已删除临时解压目录: {extract_dir}")


if __name__ == "__main__":
    main()
