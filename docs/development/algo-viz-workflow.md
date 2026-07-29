# 算法动画：代码放哪、怎么播、Agent 怎么插进 MD

## 一句话

**实现在 `apps/algo-viz`，Markdown 只写 composition 名；打开花园文章即用 Remotion Player 播放。**

```text
apps/algo-viz/src/compositions/PpoClip.tsx   ← 动画源码（唯一实现处）
apps/algo-viz/src/registry.ts               ← 注册表（前端按名查找）
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

| 步骤 | 路径 |
|---|---|
| 1. 组件 | `apps/algo-viz/src/compositions/{PascalName}.tsx` |
| 2. 注册 | `apps/algo-viz/src/registry.ts` 增加一项 |
| 3. Studio | `apps/algo-viz/src/Root.tsx` 增加 Composition |
| 4. 分镜（可选） | `apps/algo-viz/src/data/{name}-plan.json` |
| 5. 插入文章 | 目标 md 里加 ` ```viz ` |

本地预览组件：`pnpm --filter @knowpilot/algo-viz dev`  
预览嵌入效果：开花园对应文章（需 web + 已 transpile `@knowpilot/algo-viz`）。

## 用 Agent 生成并插入

仓库已有 Agent：`config/agents/algo-viz-director.md`（显示名「算法动画导演」）。

**`write_file` 权限（`apps/server/src/infra/tools/native/fs.ts` → `resolveAgentFsPath`）硬规则：**

| 路径 | 写 |
|---|---|
| `content/uploads/**` | ✅ |
| 其余 `content/**` | ❌（文章用 `post_*`，花园用 `garden_*`） |
| 其它相对路径 | → 当前 Agent 的 **Workspace**（不是项目根的 `apps/`） |

因此 Agent **不能** `write_file("apps/algo-viz/...")` 写进仓库工程目录——会落到 `workspaces/...`。  
动画组件由人在 Cursor / 本机改 `apps/algo-viz`；Agent 负责分镜、`post_update` 插 ` ```viz ` 围栏。不要擅自扩 FS 白名单。

## 和「代码预览」的区别

| 围栏 | 行为 |
|---|---|
| ` ```html ` / ` ```svg ` | iframe 预览静态页 |
| ` ```viz ` | Remotion Player 播已注册 composition |
| 普通 ` ```python ` | 仅高亮，不播动画 |

## Skill

- `config/skills/algo-viz/` — 见微编排入口  
- `config/skills/remotion-code-motion-explainer/` — 能力包（入口是 **SKILL.md**，不是 README）
