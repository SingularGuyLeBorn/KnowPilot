# PaddleOCR 本地识别（来自 MetaBlog）

KnowPilot Chat / `read_article` 图片 OCR 通过 Node 子进程调用 `paddleocr_cli.py`。

## 目录

| 路径 | 说明 |
|------|------|
| `tools/ocr/paddleocr_cli.py` | 单图 OCR CLI（JSON stdout） |
| `tools/ocr/requirements.txt` | Python 依赖锁定（paddle 2.6.2 + paddleocr 2.9.1） |
| `weights/ocr/paddleocr/` | 模型权重 det/rec/cls（不纳入 Git） |

## 快速开始

```bash
# 1. 从 MetaBlog 复制脚本与权重（不联网）
pnpm ocr:copy

# 2. 安装 Python 依赖（Windows 推荐 py -3.10）
pnpm ocr:setup

# 3. 诊断 + 试识别
pnpm ocr:check
```

## Python 环境

**已验证组合（Windows CPU）：**

- Python 3.10
- `paddlepaddle==2.6.2`
- `paddleocr==2.9.1`

> 勿用 Paddle 3.x + paddleocr 3.x：与本地 PP-OCRv4 推理包不兼容，会触发 OneDNN 错误。

`.env` 可选：

```env
PADDLEOCR_PYTHON_PATH=          # 留空则自动探测 py -3.10 / py -3.11
PPOCR_HOME=weights/ocr/paddleocr
OCR_SPACE_API_KEY=              # Paddle 失败时云端降级
```

## 权重说明

- `det` + `rec`：从 MetaBlog `pnpm ocr:copy` 复制
- `cls`：若 MetaBlog 无，首次 OCR 可能下载到 `%USERPROFILE%\.paddleocr\`；`pnpm ocr:copy` 会尝试从该缓存复制到项目 `weights/`
