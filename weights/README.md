# weights/ 目录

本目录存放项目运行所需的 AI 模型权重文件和外部二进制工具. 
这些文件体积较大,**不纳入 Git 版本控制**,由用户按需下载或自动部署. 

目录结构按功能分类: 

```
weights/
├── ocr/                    # 光学字符识别模型
│   └── paddleocr/          # PaddleOCR 模型(从 C 盘迁移至此)
├── tts/                    # 文本转语音引擎+模型
│   └── piper/
└── asr/                    # 语音转文字引擎+模型
    └── whisper/
```

---

## OCR — PaddleOCR

| 路径 | 说明 | 大小 |
|------|------|------|
| `ocr/paddleocr/whl/det/ch/ch_PP-OCRv4_det_infer/` | 中文检测模型 | ~5 MB |
| `ocr/paddleocr/whl/rec/ch/ch_PP-OCRv4_rec_infer/` | 中文识别模型 | ~11 MB |
| `ocr/paddleocr/whl/cls/ch_ppocr_mobile_v2.0_cls_infer/` | 方向分类模型 | ~2 MB |

**注意**: 首次运行会自动下载模型. 已通过 `PPOCR_HOME` 环境变量将下载路径指向本目录,不再占用 C 盘空间. 

---

## TTS — Piper(文本转语音)

| 文件 | 说明 | 大小 |
|------|------|------|
| `tts/piper/piper.exe` | Piper 主程序 | ~0.5 MB |
| `tts/piper/*.dll` | 运行依赖(onnxruntime, espeak-ng 等) | ~25 MB |
| `tts/piper/espeak-ng-data/` | 全球语言发音字典 | ~15 MB |
| `tts/piper/zh_CN-huayan-medium.onnx` | 中文语音模型(华艳声音) | ~60 MB |
| `tts/piper/zh_CN-huayan-medium.onnx.json` | 模型配置文件 | ~5 KB |

**下载地址**: 
- Piper Windows: https://github.com/rhasspy/piper/releases
- 中文模型: https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/zh/zh_CN/huayan/medium

---

## ASR — Whisper.cpp(语音转文字)

| 文件 | 说明 | 大小 |
|------|------|------|
| `asr/whisper/whisper-cli.exe` | Whisper 主程序 | ~0.5 MB |
| `asr/whisper/ggml.dll` | GGML 推理库 | ~1 MB |
| `asr/whisper/ggml-tiny.bin` | Whisper Tiny 模型权重 | ~75 MB |

**下载地址**: 
- Whisper.cpp Windows: https://github.com/ggml-org/whisper.cpp/releases
- Tiny 模型: https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny.bin

---

## 一键下载

项目根目录提供了 PowerShell 下载脚本: 
```powershell
.\scripts\download-voice-models.cjs
```

或手动复制上面的下载地址,把文件放到对应子目录即可. 
