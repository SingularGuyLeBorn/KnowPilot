# 算法动画：代码放哪、怎么播、Agent 怎么插进 MD

## 一句话

**实现在 `apps/algo-viz`，Markdown 只写 composition 名；打开花园文章即用 Remotion Player 播放。**

```text
apps/algo-viz/src/compositions/PpoClip.tsx   ← 动画源码
apps/algo-viz/src/registry-meta.json         ← 注册事实源
apps/algo-viz/src/registry.ts               ← 由 algo_viz_create 自动生成
content/**/*.md  里的 ```viz 围栏            ← 只引用 id + props
PostContent → VizEmbed → @remotion/player   ← 播放
```

## Markdown 怎么写

````markdown
```viz
composition: PpoClip
title: PPO-Clip：概率比与信任带
epsilon: 0.2
```
````

- `composition`：必须等于 `ALGO_VIZ_REGISTRY` 的 key  
- 其余键（除 title/src/poster）会进 `inputProps`  
- **不要**把 TSX 源码贴进 md  

## 新建一条动画的目录约定

| 步骤 | 做法 |
|---|---|
| 1. 创建并注册 | **`native:algo_viz_create`**（唯一写入口；自动更新 meta + `registry.ts`） |
| 2. 确认 | `native:algo_viz_list` |
| 3. 分镜（可选） | create 时传 `choreography` → `src/data/{id}-choreography.json` |
| 4. 插入文章 | `post_update` 加 ` ```viz `（id 须已在 list 中） |

**反模式**：`write_file` 写 `apps/algo-viz` / `content/uploads/viz/*.tsx`；手改 `registry.ts`（会被下次 create 覆盖——改 meta 或走工具）。

本地预览：`pnpm --filter @knowpilot/algo-viz dev`。

## 用 Agent 生成并插入（全流程）

仓库已有 Agent：`config/agents/algo-viz-director.md`（显示名「算法动画导演」）。

| 能力 | 工具 |
|---|---|
| 创建/更新动画并注册 | `algo_viz_create` |
| 列出已注册 id | `algo_viz_list` |
| 读样例 | `read_file("apps/algo-viz/...")`（只读） |
| 嵌文章 | `post_update` |

`write_file` **不能**写 `apps/algo-viz`（会报错并指向 `algo_viz_create`）。

## 和「代码预览」的区别

| 围栏 | 行为 |
|---|---|
| ` ```html ` / ` ```svg ` | iframe 预览静态页 |
| ` ```viz ` | Remotion Player 播已注册 composition |
| 普通 ` ```python ` | 仅高亮，不播动画 |

## Skill

- `config/skills/algo-viz/` — 见微编排入口  
- `config/skills/remotion-code-motion-explainer/` — 能力包（入口是 **SKILL.md**，不是 README）
