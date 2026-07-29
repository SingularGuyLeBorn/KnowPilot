# 算法可视化（config/skills）

主 Skill：[vibe-motion/remotion-code-motion-explainer](https://github.com/vibe-motion/remotion-code-motion-explainer)  
见微落点（**唯一合法位置**）：

```text
config/skills/remotion-code-motion-explainer/   # 能力包 + 镜头库
config/skills/algo-viz/                         # 见微编排入口（中文）
```

Agent 用 `skills_list` / `skill_view` 加载，与 `knowledge-garden` 相同。  
**禁止**放到 `.cursor/skills` 或 `.agents/skills`——那是 Cursor 个人目录，见微 Agent 不扫。

---

## 同步进库

```bash
pnpm db:sync
```

之后可在 `/skills` 管理页看到这两个 Skill。

---

## 开一条片

对话示例：

```text
用 skill algo-viz / remotion-code-motion-explainer，做 PPO clip 16:9 讲解。
```

工程 → `apps/algo-viz/`；成片 → `content/uploads/viz/`。

### Markdown 嵌入（前端直接跑代码）

默认路径：**不转 MP4**。文章写围栏 → `PostContent` → `VizEmbed` → `@remotion/player` 播 `apps/algo-viz` 里的 React Composition。

````markdown
```viz
composition: PpoClip
title: PPO-Clip：概率比与信任带
epsilon: 0.2
```
````

Studio 调参：`pnpm --filter @knowpilot/algo-viz dev`。MP4 / GitHub Actions 仅作导出归档可选，不是阅读路径。

### 为什么有 README 又有 SKILL.md？

上游 vibe-motion 包自带 GitHub **README 宣传页**；见微 Agent 只认 **`SKILL.md` + frontmatter**。包内其它 `.md`（含 README）sync 会跳过，不会当成第二个 Skill。

---

## GitHub Actions 出片（推荐终渲）

本地用 Remotion Studio 预览；**终渲**走独立 workflow，**不**塞进每次 PR 的 `ci.yml`（省分钟、按需触发）。

| 方式 | 命令 / 入口 |
|---|---|
| UI | GitHub → Actions → **Algo Viz Render** → Run workflow |
| CLI | `gh workflow run algo-viz-render.yml -f composition=PpoClip` |
| 带 props | `gh workflow run algo-viz-render.yml -f composition=PpoClip -f props_json='{"epsilon":0.2}'` |

产物：Actions **Artifacts**（`viz-<composition>-<run>`，保留 30 天）。下载后放到 `content/uploads/viz/`，或后续再加「自动 commit 回仓库」步骤。

前置：`apps/algo-viz` 已脚手架且含对应 Composition。定义见 `.github/workflows/algo-viz-render.yml`。

细节与反模式见 `config/skills/algo-viz/SKILL.md`。
