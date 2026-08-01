---
name: piclite-compress
description: 本地优先压图/GIF：花园配图、批量素材、清 EXIF；对接 PicLite（图轻），禁止第三方在线压图站
kind: procedural
enabled: true
version: "0.1.0"
author: KnowPilot
origin: "灵感 https://mp.weixin.qq.com/s/2FN1SDymF-h-0c6qUyUxGg ；工具 https://github.com/amiaoapp/PicLite"
---

# piclite-compress — 本地压图配文

见微配图压缩要**本地完成**，对齐 PicLite（图轻）的产品哲学：不上传陌生压图 SaaS、安装包极轻、支持静图与 GIF。

先 `skill_view(name="piclite-compress")`，再动手。

## 何时用

- 文章/公众号配图太大（上传限制、加载慢）
- 批量产品图、PNG↔WebP、GIF 演示压缩
- 含隐私的截图：要缩小且清 EXIF/GPS
- 用户明确说「不要传到在线压图网站」

## 硬约束

1. **禁止**把原图/截图上传到 TinyPNG、iLoveIMG 等第三方压图 API（除非用户书面明确要求且接受外传）。
2. **禁止** `write_file` 直写 `content/{garden}/*.md` 正文配图路径时绕过 Post 管道——成文用 `post_create` / `post_update`；二进制进 `content/uploads/`。
3. 工作原图优先放在**当前 Agent Workspace**（如 `raw-photos/`），压完再复制/上传到 uploads。
4. 未确认 PicLite/本机工具可用时，先检查再压，失败给安装指引，不假装已压成功。

## 推荐工具链

| 步骤 | 做法 |
|------|------|
| 看源文件 | `list_directory` / `read_file`（元信息） |
| 加载本说明 | `skill_view piclite-compress` |
| 本地压缩 | 见下方「执行顺序」 |
| 入库引用 | 文件到 `content/uploads/...` 后，Markdown `![](...)`；文章用 `post_*` |
| 成文 | `post_create` / `post_update` / Chat「写入知识库」 |

## 执行顺序

1. **确认输入**：路径、目标体积（如 ≤1MB）、最长边、是否 WebP、是否 GIF、是否去元数据。
2. **探测本机**（`run_shell`，按平台调整）：
   - 是否存在 PicLite 可执行文件 / 用户常用安装路径；
   - 或是否已有 **本地** 后备：`ffmpeg`（GIF/转码）、`magick`（ImageMagick）——仅作后备，仍须本机执行。
3. **压缩**：
   - **已装 PicLite 桌面版**：指导用户拖入目标目录，或使用其「文件夹监测 / 导出到子目录 PicLite/」；Agent 用 `list_directory` 收取输出文件并汇报体积对比。
   - **有 CLI/脚本**：在 Workspace 内执行，输出旁路文件（保留原图），命名如 `foo-piclite.webp`。
   - **都没有**：回复安装链接  
     - 文案介绍：https://mp.weixin.qq.com/s/2FN1SDymF-h-0c6qUyUxGg  
     - GitHub：https://github.com/amiaoapp/PicLite  
     询问是否改用本机 `ffmpeg` 后备。
4. **汇报**：每个文件「原大小 → 新大小 → 相对 projectRoot 或 uploads 的路径」。
5. **可选成文**：用户要配进文章时再改 Post，不擅自发布。

## 目标参数（缺省）

用户未指定时建议：

- 静图：质量约 70%、最长边 1600px、优先 WebP（若发布渠道不支持则 JPG）
- GIF：先保动画，目标 < 原体积 40% 或用户给的 MB 上限
- 隐私：清除 EXIF/GPS（PicLite 元数据清理或等价本地选项）

## 反模式

- 为「省事」调用在线压图 HTTP API
- 同一路径压失败后同参死循环（≥3 次同参会熔断）
- 压完只说「好了」不给路径与体积

## 和场景文档的关系

产品叙事与理想对话见 `docs/development/scenarios.md` **场景 D**。
