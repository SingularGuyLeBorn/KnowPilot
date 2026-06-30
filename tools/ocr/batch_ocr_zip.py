#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PaddleOCR ZIP 批量识别服务

用法:
    python batch_ocr_zip.py <zip_path> [output_dir] [options]

功能:
    1. 自动解压 ZIP
    2. 多进程并行 OCR（默认 12 进程，适配 9700X3D）
    3. 过滤无文字结果（仅保留识别到文字的图片）
    4. 按目录结构输出为多个 MD 文档

依赖安装:
    pip install paddleocr paddlepaddle

注意:
    - 首次运行会自动下载 PaddleOCR 模型（约 30-40MB）到 weights/ocr/paddleocr/
    - 模型下载可能需要代理，如果失败请手动下载放到对应目录
    - 大 ZIP 文件解压需要足够的磁盘空间
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
from multiprocessing import cpu_count
from pathlib import Path

# ==================== 模型路径配置 ====================

_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(_script_dir)))
_MODEL_BASE = os.path.join(_project_root, "weights", "ocr", "paddleocr")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}
DEFAULT_WORKERS = min(12, cpu_count())  # 9700X3D 留余量
DEFAULT_BATCH_SIZE = 50                 # 每批处理数量（控制内存）
DEFAULT_CONFIDENCE = 0.7                # 文字行置信度阈值
IMAGES_PER_MD = 200                     # 单个 MD 文件最大图片数

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
    """创建 PaddleOCR 实例（单线程模式）"""
    from paddleocr import PaddleOCR
    model_paths = get_model_paths(lang)
    return PaddleOCR(
        lang=lang,
        use_gpu=False,
        show_log=False,
        enable_mkldnn=True,  # 启用 MKL-DNN 加速（Intel CPU）
        det_model_dir=model_paths["det"],
        rec_model_dir=model_paths["rec"],
        cls_model_dir=model_paths["cls"],
    )


def ocr_single_image(ocr_instance, image_path: str, base_dir: str) -> dict:
    """
    单张图片 OCR（单线程模式）

    Args:
        ocr_instance: PaddleOCR 实例
        image_path: 图片路径
        base_dir: 解压目录（用于计算相对路径）

    Returns:
        {"rel_path": str, "text": str, "lines": int, "elapsed_ms": float, "has_text": bool}
    """
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
        # 安全检查：防止 Zip Slip
        for member in zf.namelist():
            member_path = os.path.join(extract_dir, member)
            if not os.path.commonprefix([extract_dir, member_path]).startswith(extract_dir):
                raise ValueError(f"ZIP 包含非法路径: {member}")
        zf.extractall(extract_dir)

    # 收集所有图片
    image_paths = []
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if Path(f).suffix.lower() in IMAGE_EXTS:
                image_paths.append(os.path.join(root, f))

    image_paths.sort()
    print(f"[1/5] 解压完成，共发现 {len(image_paths)} 张图片")
    return image_paths


def batch_process(
    image_paths: list,
    extract_dir: str,
    batch_size: int = DEFAULT_BATCH_SIZE,
    lang: str = "ch",
) -> list:
    """单线程顺序处理图片 OCR（Windows 多进程兼容性问题，改用单线程）"""
    total = len(image_paths)
    print(f"[2/5] 启动单线程 OCR（共 {total} 张）")

    # 初始化 OCR 实例（单例）
    ocr_instance = create_ocr_instance(lang)

    results = []
    start_total = time.time()

    for i, image_path in enumerate(image_paths, 1):
        result = ocr_single_image(ocr_instance, image_path, extract_dir)
        results.append(result)

        # 每 50 张输出一次进度
        if i % 50 == 0 or i == total:
            elapsed = time.time() - start_total
            avg = elapsed / i if i > 0 else 0
            remaining = (total - i) * avg
            print(f"[2/5] 进度: {i}/{total} | 已用 {elapsed:.1f}s | 预计剩余 {remaining:.1f}s")

    total_elapsed = time.time() - start_total
    print(f"[2/5] OCR 完成，总耗时 {total_elapsed:.1f}s，平均 {total_elapsed / total:.2f}s/张")
    return results


def filter_and_group(results: list, strategy: str = "directory") -> dict:
    """
    过滤无文字结果并按策略分组

    Args:
        results: OCR 结果列表
        strategy: "directory" 按目录分组，"count" 按固定数量分组

    Returns:
        {"groups": {group_name: [result, ...]}, "stats": {...}}
    """
    print(f"[3/5] 过滤无文字结果并分组（策略: {strategy}）")

    # 过滤
    valid_results = [r for r in results if r.get("has_text") and not r.get("error")]
    empty_results = [r for r in results if not r.get("has_text")]
    error_results = [r for r in results if r.get("error")]

    print(f"[3/5] 有效结果: {len(valid_results)} | 无文字: {len(empty_results)} | 失败: {len(error_results)}")

    # 分组
    groups = defaultdict(list)

    if strategy == "directory":
        for r in valid_results:
            # 取相对路径的目录部分作为组名
            dir_name = os.path.dirname(r["rel_path"])
            if not dir_name:
                dir_name = "root"
            groups[dir_name].append(r)
    else:
        # 按固定数量分组
        for i, r in enumerate(valid_results):
            group_idx = i // IMAGES_PER_MD
            groups[f"batch_{group_idx + 1:03d}"].append(r)

    # 如果某组太大，进一步拆分
    final_groups = {}
    for name, items in groups.items():
        if len(items) > IMAGES_PER_MD:
            for i in range(0, len(items), IMAGES_PER_MD):
                sub = items[i:i + IMAGES_PER_MD]
                final_groups[f"{name}_part{i // IMAGES_PER_MD + 1}"] = sub
        else:
            final_groups[name] = items

    stats = {
        "total_images": len(results),
        "valid": len(valid_results),
        "empty": len(empty_results),
        "errors": len(error_results),
        "groups": len(final_groups),
    }

    return {"groups": final_groups, "stats": stats}


def write_md_files(groups: dict, output_dir: str, zip_name: str):
    """将分组结果写入 Markdown 文件"""
    print(f"[4/5] 写入 Markdown 文件到: {output_dir}")

    os.makedirs(output_dir, exist_ok=True)

    # 写入统计信息
    summary_path = os.path.join(output_dir, "_summary.md")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"# OCR 识别结果汇总\n\n")
        f.write(f"- **来源 ZIP**: `{zip_name}`\n")
        f.write(f"- **输出时间**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- **分组数**: {len(groups)}\n\n")
        f.write("## 文件清单\n\n")
        for name in sorted(groups.keys()):
            f.write(f"- [{name}.md]({name}.md) — {len(groups[name])} 张图片\n")
        f.write("\n")

    # 写入各组结果
    for name, items in groups.items():
        md_path = os.path.join(output_dir, f"{name}.md")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(f"# {name}\n\n")
            f.write(f"> 共 {len(items)} 张图片\n\n")

            for i, item in enumerate(items, 1):
                f.write(f"## {i}. `{item['rel_path']}`\n\n")
                if item["text"]:
                    # 转义 Markdown 特殊字符
                    text = item["text"].replace("|", "\\|").replace("\n", "\n\n")
                    f.write(f"{text}\n\n")
                else:
                    f.write("_（未识别到文字）_\n\n")
                f.write("---\n\n")

    print(f"[4/5] 已写入 {len(groups) + 1} 个 Markdown 文件")


def write_json_results(results: list, output_dir: str):
    """可选：写入完整 JSON 结果"""
    json_path = os.path.join(output_dir, "_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"[5/5] 完整 JSON 结果已保存: {json_path}")


def main():
    parser = argparse.ArgumentParser(description="PaddleOCR ZIP 批量识别服务")
    parser.add_argument("zip_path", help="输入 ZIP 文件路径")
    parser.add_argument("output_dir", nargs="?", default=None, help="输出目录（默认: ZIP同名目录）")
    parser.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS, help=f"进程数（默认: {DEFAULT_WORKERS}）")
    parser.add_argument("--batch-size", "-b", type=int, default=DEFAULT_BATCH_SIZE, help=f"每批数量（默认: {DEFAULT_BATCH_SIZE}）")
    parser.add_argument("--lang", "-l", default="ch", help="语言: ch/en/japan/korean（默认: ch）")
    parser.add_argument("--strategy", "-s", default="directory", choices=["directory", "count"], help="分组策略（默认: directory）")
    parser.add_argument("--keep-extract", action="store_true", help="保留解压后的临时目录（调试用）")
    parser.add_argument("--no-json", action="store_true", help="不输出 JSON 结果文件")

    args = parser.parse_args()

    zip_path = os.path.abspath(args.zip_path)
    if args.output_dir:
        output_dir = os.path.abspath(args.output_dir)
    else:
        output_dir = os.path.splitext(zip_path)[0] + "_ocr"

    print("=" * 60)
    print("PaddleOCR ZIP 批量识别服务")
    print("=" * 60)
    print(f"ZIP 文件: {zip_path}")
    print(f"输出目录: {output_dir}")
    print(f"进程数: {args.workers}")
    print(f"语言: {args.lang}")
    print(f"分组策略: {args.strategy}")
    print("=" * 60)

    # 创建临时解压目录
    extract_dir = tempfile.mkdtemp(prefix="paddleocr_extract_")

    try:
        # 1. 解压
        image_paths = extract_zip(zip_path, extract_dir)
        if not image_paths:
            print("[错误] ZIP 中未找到图片文件")
            sys.exit(1)

        # 2. 单线程 OCR
        results = batch_process(
            image_paths,
            extract_dir,
            batch_size=args.batch_size,
            lang=args.lang,
        )

        # 4. 过滤分组
        grouped = filter_and_group(results, strategy=args.strategy)
        groups = grouped["groups"]
        stats = grouped["stats"]

        # 5. 输出 MD
        zip_name = os.path.basename(zip_path)
        write_md_files(groups, output_dir, zip_name)

        # 6. 输出 JSON（可选）
        if not args.no_json:
            write_json_results(results, output_dir)

        # 最终统计
        print("\n" + "=" * 60)
        print("处理完成")
        print("=" * 60)
        print(f"总图片数: {stats['total_images']}")
        print(f"识别成功（有文字）: {stats['valid']}")
        print(f"无文字: {stats['empty']}")
        print(f"识别失败: {stats['errors']}")
        print(f"输出分组: {stats['groups']}")
        print(f"输出目录: {output_dir}")
        print("=" * 60)

    finally:
        # 清理临时目录
        if not args.keep_extract and os.path.exists(extract_dir):
            shutil.rmtree(extract_dir)
            print(f"[清理] 已删除临时解压目录: {extract_dir}")


if __name__ == "__main__":
    main()
