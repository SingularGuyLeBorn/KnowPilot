---
name: wechat-article-remotion
description: 微信/网页文章 → 本地材料包 → beats 分镜 → Remotion 成片（声音/字幕驱动画面；不依赖 Ideaflow）
kind: procedural
enabled: true
version: "0.1.0"
author: OasisMind
origin: "灵感 video-skills-toolkit / wechat-article-remotion；https://mp.weixin.qq.com/s/YqnCTo8F6k2EbX3jD0icPg ；https://github.com/liangdabiao/video-skills-toolkit"
---

# wechat-article-remotion — 文章成片（见微）

核心理念（与上游一致）：**先钉时间线，再铺画面**。  
见微落地：**本地抓取材料包**（`article_material_pack`）→ AI 填 `beats.json` → `article_video_compose` 注册 Remotion → 文章插 ```viz。

先 `skill_view(name="wechat-article-remotion")`。细则：`references/beat-checklist.md`。

## 何时用

- 「把这篇微信/博客做成短视频 / Remotion 片」
- 「文章转视频，字幕对齐画面」
- 本地已有 Markdown + 配图目录（可跳过抓取，手写 pack）

## 硬约束

1. **禁止**依赖 Ideaflow / 其它第三方「文章转 MD」黑盒；抓取只用 `article_material_pack` / `read_article`。
2. **禁止** `write_file` 写 `apps/algo-viz/**`；成片注册只用 `article_video_compose` 或 `algo_viz_create`。
3. `article-image` **只能**用材料包 `images.json` 里真实存在的 `imageId`，且**同一张图不重复**。
4. 原文配图渲染必须 `object-fit: contain`（compose 模板已遵守），禁止 cover 裁切信息图。
5. 同一种 `kind` **不要连续**两镜。
6. 每屏文字元素 ≤5；字幕关键词 3～5 字。
7. TTS / 云字幕为**可选**：未配置 MiniMax / MediaKit 时做无声预览，用 `caption` 当旁白条；有真实音频后再按字幕改 `durationSec`。

## 工具

| 步骤 | 工具 |
|------|------|
| 材料包 | `article_material_pack` |
| 读稿 | `read_file`（pack 内 article.md） |
| 分镜规则 | `skill_view` 本包 `references/beat-checklist.md` |
| 注册成片 | `article_video_compose` |
| 列表确认 | `algo_viz_list` |
| 落文 | `post_create` / `post_update` 插 ```viz |
| 单图补下 | `download_file`（自动 Referer） |

## 标准流程

1. **材料包**  
   `article_material_pack({ url: "https://mp.weixin.qq.com/s/..." })`  
   得到 `packDir`、`article.md`、`images.json`、`beats.json` 模板；图已进 `apps/algo-viz/public/packs/{slug}/`。

2. **拆稿（AI）**  
   通读 `article.md`，按 checklist 改 `beats.json`：**6～12** 个 scene。  
   `kind` ∈ `cover | bullets | stat | compare | article-image | outro`。

3. **成片**  
   `article_video_compose({ packDir, compositionId: "WechatYourTopic" })`  
   → 写 composition + registry；返回 `vizFenceExample`。

4. **预览**  
   - Studio：`pnpm --filter @knowpilot/algo-viz dev`  
   - 低清：`pnpm --filter @knowpilot/algo-viz preview <Id> --output=out/preview.mp4`  
   - 静帧：`pnpm --filter @knowpilot/algo-viz still <Id> --frame=30`

5. **嵌入花园**  
   `post_update` 插入：

```viz
composition: WechatYourTopic
```

## 可选：TTS / 字幕钉时间线

若本机已配置上游同类服务（MiniMax TTS、字幕识别等），在材料包生成 `audio/` + `captions.json` 后：

1. 用真实字幕起止改每个 scene 的 `durationSec`；
2. 再跑 `article_video_compose`；
3. **不要**让 AI 手改一长串帧号却无音频依据。

无外部凭证时：保持无声 + caption 旁白条，先交付可播预览。

## 本地 Markdown 入口（无 URL）

手动建目录：

```text
article-videos/my-pack/
  article.md
  images/img_01.jpg
  images.json   # id/fileName/staticFile…
  beats.json
```

把图复制到 `apps/algo-viz/public/packs/my-pack/`（或再跑一遍 pack 工具），然后 `article_video_compose`。

## 反模式

- 用 `browser_screenshot` 代替读正文做片
- 把 Remotion 源码整段贴进 Markdown
- 未改 beats 模板就 compose（要点仍是占位句）
- 教用户跑 cp/deploy 脚本

## 场景文档

见 `docs/development/scenarios.md` 场景 E。
