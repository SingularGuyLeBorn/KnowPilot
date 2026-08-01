---
name: algo-viz
description: >-
  见微算法可视化编排：MLA / PPO / Attention / 扩散等讲解片。默认白底教学风，片内必须有公式与讲解旁白条。
  委托 remotion-code-motion-explainer；工程 apps/algo-viz；用 native:algo_viz_create，禁止 write_file 写动画。
kind: procedural
enabled: true
version: "0.3.0"
author: KnowPilot
---

# algo-viz — 算法可视化（见微）

## 何时用

- 「给 MLA / PPO / 注意力 / 扩散做动画讲解」
- 「3b1b 风格 / 板书式算法动画」
- 「Remotion Code Motion Explainer」

微信/博客**文章转短片**请改走 Skill `wechat-article-remotion`（`article_material_pack` → `beats.json` → `article_video_compose`），不要用算法白底模板硬套长文。

## 教学验收铁律（v0.3）

> 完整清单见 `skill_view(name="algo-viz", file_path="references/algorithm-explainer-pedagogy.md")`。

1. **白底**：`AbsoluteFill` 背景默认 `#FFFFFF` / `#F7F8FA`，主字深色。**禁止**默认黑底霓虹（口播片另论）。
2. **片内公式**：主公式至少出现一次，并用高亮与图元联动；禁止「动画只有色块、公式只写在文章里」。
3. **讲解旁白条**：每拍底部/侧栏短句（≤28 字），静音可懂；与关键动作同帧起步。
4. **状态机完整**：每拍 = 输入 → 动作 → 可见结果 → handoff；缺结果 = 不合格。
5. **对照**：至少一处前后/左右/对错对比（算法讲解几乎总需要）。
6. **像画插图**：先设计最大信息量静帧，再让对象动起来（动画 = 一帧帧图）。

不满足 1–4 → **不得** `algo_viz_create` 交片，先改 choreography / 源码。

## 硬约束

1. **Skill 只在 `config/skills/`**。禁止写入 `.cursor/skills`、`.agents/skills`。
2. 主能力包：`skill_view(name="remotion-code-motion-explainer")`，再按需读其 `references/*`。
3. **必读教学规范**：`skill_view(name="algo-viz", file_path="references/algorithm-explainer-pedagogy.md")`。
4. 镜头库：`remotion-code-motion-explainer/assets/shot-library/shot-library.json` —— **复制**到 `apps/algo-viz/`，勿改 skill 目录。
5. 文章嵌入 ` ```viz ` + composition 名（前端 Remotion Player，默认不转 MP4）。
6. 禁止把整段 Remotion 源码贴进 `content/**/*.md`。
7. 时间轴只用 `useCurrentFrame()`；禁止 CSS keyframes / 非种子随机。
8. **创建动画唯一工具：`algo_viz_create`**（写 composition + `registry-meta.json` + 重生 `registry.ts`）。  
   **禁止** `write_file` 写 `apps/algo-viz/**`。
9. `content/uploads/viz/` 只放可选 MP4/海报，**不放** Remotion 源码。
10. 对照样例：`read_file("apps/algo-viz/src/compositions/PpoClip.tsx")`（只读）；列表用 `algo_viz_list`。
11. **禁止让用户跑部署脚本**（`cp` / `deploy-*.sh` / `bash`）。`algo_viz_create` 即部署完成。  
    **禁止**声称「sandbox / 无法写入 apps/algo-viz」——那是假借口。

## 工具：`algo_viz_create`

| 参数 | 必填 | 说明 |
|---|---|---|
| `compositionId` | ✅ | PascalCase，如 `PpoClip` |
| `source` | ✅ | 完整 `.tsx`；须 `export const Id` / `export function Id` |
| `durationInFrames` | | 默认 180 |
| `fps` / `width` / `height` | | 默认 30 / 1280 / 720 |
| `defaultProps` | | Player 默认 props |
| `choreography` | ✅ 推荐 | 写入 `src/data/{id}-choreography.json`（含 formulaHighlight / caption） |
| `overwrite` | | 默认 true |

返回含 `vizFenceExample`，可直接用于 `post_update`。配套：`algo_viz_list`。

## 工作流

1. `skill_view` 加载本包 pedagogy + `remotion-code-motion-explainer`。
2. 写中文讲解脚本（问题 → 符号 → 机制拍 → 对照 → takeaway）。
3. 填 choreography（每拍：statement / formulaHighlight / caption / actors / result）。
4. 先画 3 张静帧（hook / 最复杂机制 / takeaway），确认白底可读。
5. Remotion 源码（SVG/HTML 优先）→ **`algo_viz_create`** → **`algo_viz_list`** → **`post_update` 插 viz**。
6. 文章侧仍写完整公式与文字讲解；viz 只嵌 id。

```viz
composition: PpoClip
title: PPO-Clip
epsilon: 0.2
```

## 推荐调色板（粘进 composition 常量）

```ts
const BG = "#FFFFFF";
const INK = "#1A1D26";
const MUTED = "#5C6578";
const ACCENT = "#2563EB";
const OK = "#059669";
const WARN = "#DC2626";
const PANEL = "#F1F5F9";
const LINE = "#E2E8F0";
```

## 开场提示（可贴给用户）

**MLA：** 多头 QKV → latent 瓶颈 → 取回 → 显存对比；白底；公式 + 旁白条；props 化。

**PPO Clip：** ratio 曲线 → `[1-ε,1+ε]` 夹逼公式联动 → 越界变色 → A>0/A<0；白底；props 化。

**扩散 vs AR：** 左串行 / 右并行；同前缀对照；片内写清「一步写几个位置」；白底。

## 辅路径

| 场景 | 做法 |
|---|---|
| 源码 diff 打字机 | 外置 bang9/code-motion（非本包默认） |
| 文内可交互滑块 | 花园 React + Framer Motion |
| Remotion API | `npx skills add remotion-dev/skills` → **本仓库 `config/skills/`** |
| 口播黑底片 | 用 remotion-code-motion-explainer 口播镜头；**不要**与算法教学片混用默认主题 |
