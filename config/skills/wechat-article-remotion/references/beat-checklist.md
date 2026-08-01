# Beat checklist（文章成片）

## 目标

把长文压成 **6～12** 个 beat，每个 beat 落到一种版式，并带一句可朗读的 `caption`（3～5 字关键词或短旁白）。

## scene.kind

| kind | 用途 | 必填字段 |
|------|------|----------|
| `cover` | 开场标题 | `title`；可选 `subtitle` |
| `bullets` | 要点列表 | `title` + `bullets`（≤5） |
| `stat` | 数据大字 | `value` + `label`/`title` |
| `compare` | 左右对比 | `left` + `right` |
| `article-image` | 原文真图 | `imageId`（来自 images.json）；可选 `title` |
| `outro` | 收尾 | `title`；可选 `subtitle` |

## 规则

1. 先通读全文，抽出主题 + **≤3** 条关键结论 + 信息量最高的图。
2. 同一种 `kind` 不要连续出现。
3. `article-image` 只用材料包里真实图片；同一 `imageId` 全片只用一次。
4. 每屏文字元素 ≤5（含标题/条目）。
5. 默认 `durationSec`：cover 3、bullets 5、image 4、stat 3、compare 5、outro 2.5；有 TTS 后按字幕重算。
6. 流程图/表格类图优先进片，装饰图可丢。

## beats.json 形状

```json
{
  "title": "文章标题",
  "fps": 30,
  "width": 1280,
  "height": 720,
  "scenes": [
    { "kind": "cover", "durationSec": 3, "title": "…", "subtitle": "…", "caption": "开场" },
    { "kind": "bullets", "durationSec": 5, "title": "结论", "bullets": ["a", "b", "c"], "caption": "三点" },
    { "kind": "article-image", "durationSec": 4, "imageId": "img_01", "title": "图注", "caption": "原图" },
    { "kind": "outro", "durationSec": 2.5, "title": "见微", "caption": "收尾" }
  ]
}
```

## QC（交付前）

- [ ] 每镜开始后 ~0.3s 与中段：文字可读、无裁切关键图
- [ ] 字幕/旁白条不挡主体
- [ ] Studio 或 preview 能播完整片
- [ ] 花园 ```viz composition 与 registry 一致
