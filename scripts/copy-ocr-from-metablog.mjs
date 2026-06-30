#!/usr/bin/env node
/**
 * 从 MetaBlog 复制 OCR 代码与权重到 KnowPilot（不联网下载）
 *
 * 用法: node scripts/copy-ocr-from-metablog.mjs [MetaBlog根目录]
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const META_BLOG = process.argv[2] || path.join(ROOT, "..", "MetaBlog");

const JOBS = [
  {
    label: "PaddleOCR CLI 脚本",
    src: path.join(META_BLOG, "project", "experiments", "paddleocr-test"),
    dest: path.join(ROOT, "tools", "ocr"),
    files: ["paddleocr_cli.py", "batch_ocr_zip.py", "batch_ocr_zip_threaded.py"],
  },
  {
    label: "OCR 模型权重",
    src: path.join(META_BLOG, "weights", "ocr", "paddleocr"),
    dest: path.join(ROOT, "weights", "ocr", "paddleocr"),
  },
  {
    label: "weights 说明",
    src: path.join(META_BLOG, "weights", "README.md"),
    dest: path.join(ROOT, "weights", "README.md"),
    file: true,
  },
];

function robocopyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠ 跳过（源不存在）: ${src}`);
    return 0;
  }
  fs.mkdirSync(dest, { recursive: true });
  const cmd = `robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /nc /ns /np`;
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    const code = err.status ?? 1;
    if (code >= 8) throw err;
  }
  return countModels(dest);
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠ 跳过（源不存在）: ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function countModels(base) {
  if (!fs.existsSync(base)) return 0;
  let n = 0;
  for (const root of walk(base)) {
    if (root.endsWith("inference.pdiparams")) n++;
  }
  return n;
}

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function patchPythonPaths(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  const oldBlock =
    '_project_root = os.path.dirname(os.path.dirname(os.path.dirname(_script_dir)))';
  const newBlock =
    '_project_root = os.path.dirname(os.path.dirname(_script_dir))\n_MODEL_BASE = os.environ.get("PPOCR_HOME") or os.path.join(_project_root, "weights", "ocr", "paddleocr")';
  if (text.includes(oldBlock)) {
    text = text.replace(
      /# 推断项目根目录[^\n]*\n_script_dir = os\.path\.dirname\(os\.path\.abspath\(__file__\)\)\n_project_root = os\.path\.dirname\(os\.path\.dirname\(os\.path\.dirname\(_script_dir\)\)\)\n_MODEL_BASE = os\.path\.join\(_project_root, "weights", "ocr", "paddleocr"\)/,
      `# 推断项目根目录（KnowPilot: tools/ocr/ → 上两级）\n_script_dir = os.path.dirname(os.path.abspath(__file__))\n${newBlock}`,
    );
    fs.writeFileSync(filePath, text);
  }
}

console.log(`📂 MetaBlog: ${META_BLOG}`);
console.log(`📂 KnowPilot: ${ROOT}\n`);

for (const job of JOBS) {
  console.log(`→ ${job.label}`);
  if (job.file) {
    copyFile(job.src, job.dest);
    continue;
  }
  if (job.files) {
    fs.mkdirSync(job.dest, { recursive: true });
    for (const name of job.files) {
      copyFile(path.join(job.src, name), path.join(job.dest, name));
      patchPythonPaths(path.join(job.dest, name));
    }
    continue;
  }
  const models = robocopyDir(job.src, job.dest);
  console.log(`  模型包数量(inference.pdiparams): ${models}`);
}

const total = countModels(path.join(ROOT, "weights", "ocr", "paddleocr"));
console.log(`\n✅ 完成。KnowPilot 现有 ${total} 个 Paddle 推理包。`);

const userCls = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".paddleocr",
  "whl",
  "cls",
  "ch_ppocr_mobile_v2.0_cls_infer",
);
const destCls = path.join(ROOT, "weights", "ocr", "paddleocr", "whl", "cls", "ch_ppocr_mobile_v2.0_cls_infer");
if (total < 3 && fs.existsSync(userCls)) {
  console.log(`→ 从本机 Paddle 缓存复制 cls: ${userCls}`);
  robocopyDir(userCls, destCls);
}

const finalTotal = countModels(path.join(ROOT, "weights", "ocr", "paddleocr"));
if (finalTotal < 3) {
  console.log(
    "⚠ MetaBlog 源目录里权重不完整（常见：只有 README，模型在首次 OCR 时才下载到 weights/ocr/paddleocr/）。\n" +
      "  若 MetaBlog 本机已跑通过 OCR，请确认 weights/ocr/paddleocr/whl 下有 det/rec/cls 三套，再重跑本脚本。",
  );
}
