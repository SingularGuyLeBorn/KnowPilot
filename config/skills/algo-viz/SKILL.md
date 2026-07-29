---
name: algo-viz
description: >-
  见微算法可视化编排：MLA / PPO / Attention 等讲解片。默认委托 remotion-code-motion-explainer，
  工程 apps/algo-viz，成片 content/uploads/viz。禁止把 Skill 放进 .cursor/。
kind: procedural
enabled: true
version: "0.1.0"
author: KnowPilot
---

# algo-viz — 算法可视化（见微）

## 何时用

- 「给 MLA / PPO / 注意力做动画讲解」
- 「Remotion Code Motion Explainer」
- 「算法可视化 / 3b1b 风格短片」

## 硬约束

1. **Skill 只在 `config/skills/`**。禁止写入 `.cursor/skills`、`.agents/skills`。
2. 主能力包：`skill_view(name="remotion-code-motion-explainer")`，再按需
   `skill_view(name="remotion-code-motion-explainer", file_path="references/code-motion-design.md")` 等。
3. 镜头库：同包 `assets/shot-library/shot-library.json` —— **复制**到 `apps/algo-viz/`，勿改 skill 目录。
4. 文章嵌入 ` ```viz ` + composition 名（前端 Remotion Player 跑代码，默认不转 MP4）。
5. 禁止把整段 Remotion 源码贴进 `content/**/*.md`——只嵌 composition id / props；实现放 `apps/algo-viz`。
6. 时间轴只用 `useCurrentFrame()`；禁止 CSS keyframes / 非种子随机。
7. **Skill 入口是 `SKILL.md`，不是 `README.md`**。

## 工作流

1. `skills_list` / `skill_view` 加载 `remotion-code-motion-explainer`。
2. 写中文讲解脚本（输入状态 → 变换 → 可见结果）。
3. 按 Explainer Skill：分镜 → 持续对象表 → 检索镜头库 → Remotion 实现 → QC。
4. 工程在 `apps/algo-viz/`；注册表 `src/registry.ts`；Studio：`pnpm --filter @knowpilot/algo-viz dev`。
5. 文章嵌入（阅读路径）：

```viz
composition: PpoClip
title: PPO-Clip
epsilon: 0.2
```


## GitHub Actions 终渲

仓库已有 `.github/workflows/algo-viz-render.yml`（`workflow_dispatch`，不进日常 CI）。

```bash
# 本机已登录 gh、且 apps/algo-viz 含该 composition
gh workflow run algo-viz-render.yml -f composition=PpoClip
# 可选 props
gh workflow run algo-viz-render.yml -f composition=PpoClip -f props_json='{"epsilon":0.2}'
```

Agent：实现完 composition 后提醒用户跑上述命令，或代跑 `gh workflow run`；勿把整段 Remotion 终渲塞进每次 `pnpm test` / PR CI。

## 开场提示（可贴给用户）

**MLA：** 多头 QKV → latent 瓶颈 → 取回 → 显存对比；16:9；静音可懂；props 化。

**PPO Clip：** ratio 曲线 → `[1-ε,1+ε]` 夹逼 → 越界变灰 → A>0/A<0；16:9；props 化。

## 辅路径

| 场景 | 做法 |
|---|---|
| 源码 diff 打字机视频 | 外置 bang9/code-motion / Codemotion（非本包默认） |
| 文内可交互滑块 | 花园 React + Framer Motion（不必 Remotion） |
| Remotion API 细节 | 另装 `npx skills add remotion-dev/skills` 到 **本仓库 `config/skills/`**，不要装进 `.cursor` |
