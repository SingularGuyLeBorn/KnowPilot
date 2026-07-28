---
name: knowledge-garden
description: 创建与维护主题知识库：建库、深度长文、站内链、过夜 Goal
kind: procedural
enabled: true
version: "0.2.0"
author: KnowPilot
---

# knowledge-garden — KnowPilot 主题知识库

灵感来自 Karpathy llm-wiki（编译一次、持续维护），**必须用 KnowPilot 原生能力**落地，禁止按 Obsidian/`raw`/`wiki` 目录或上游 bash 脚本操作。

参考（勿直接跑）：`tmp/upstream-skills/trending-skills/skills/llm-wiki-skill/`、`references/upstream.md`。

## 何时用

- 「建一个关于 XX 的知识库 / 花园」
- 「Goal 过夜搭初版，明早看」
- 「给现有库补文 / 健康检查」

先 `skill_view(name="knowledge-garden")`，再执行。需要模板时 `skill_view(name="knowledge-garden", file_path="templates/article.md")`。

## 硬约束

1. **禁止** `write_file` 直写 `content/`（除 `uploads/`）。建库 `garden_create`，写文 `post_create` / `post_update`。
2. 花园 id：`^[a-z][a-z0-9_-]{0,62}$`；勿占 `about`/`uploads`；勿删种子库 `posts`/`knowledge`/`resources`。
3. 写文前 `garden_list` / `garden_get` 确认目标库。
4. **禁止**把「相关」写成裸 `[[01-foo/bar]]` 且无标题——用户在所见即所得编辑器里会看到路径灰块且难读。
5. 过夜 Goal：机器与 `pnpm dev` 须保持运行（重启不自动续跑）。

## KnowPilot Markdown 约定（必读）

| 用途 | 正确写法 | 错误 |
|------|----------|------|
| 相关文章 | `[中文标题](./同库相对路径.md)` 或 `[[slug\|中文标题]]` | 单独一行裸 `[[slug]]` |
| 外链来源 | `[论文标题](https://...)` + 一句话取用理由 | 只贴 URL |
| 公式 | 正文用 `$$...$$` / 行内 `$...$`（用户可 `/gs`） | 用图片糊公式 |
| 代码 | 围栏代码块（用户可 `/code`） | 把大段伪码塞进普通段落 |
| 对比表 | GFM 表（用户可 `/tb`） | 只用「待补充：做个表」敷衍 |
| 示意图 | 需要时 `/hb` 画板或 ` ```svg ` | 空喊「见图」 |

首页 `_garden.md`（`garden_update.homeContent`）用可读目录 + Markdown 链接指向已有文章，不要堆未解析的 wiki 路径。

## 文章质量硬标准（反空洞）

每篇 `post_create` / 实质更新必须同时满足：

1. **正文（不含标题/frontmatter）≥ 800 汉字**（综述/对比文 ≥ 1200）。
2. 必备小节（可用不同标题，但内容要在）：
   - **概述**：问题背景与本文贡献（≥ 120 字）
   - **核心机制 / 方法**：讲清楚 how，含至少 1 个公式块或伪代码块或步骤列表
   - **例子或对比**：具体数字、场景、与基线/竞品的差异（可用表格）
   - **来源**：≥ 1 条可点外链 + 取用理由
   - **相关**：≥ 2 条**带中文标题**的同库链接（文章尚不存在时可先建骨架文再链）
3. **禁止**以「待补充」列表作为正文主体；待补充最多 3 条，且不影响上面字数。
4. `excerpt` 必须是完整一句话摘要，不是 slug 或「TODO」。
5. Goal 完成标准看**深度与可读性**，不是「凑满 N 篇空壳」。宁可不达标续跑，也不要批量 `post_create` 200 字占位。

模板见 `templates/article.md` / `templates/home.md`（填满占位，勿原样提交）。

## 工具

| 阶段 | 工具 |
|------|------|
| Skill | `skills_list` `skill_view` |
| 花园 | `garden_list` `garden_create` `garden_get` `garden_update` |
| 文章 | `post_list` `post_create` `post_update` |
| 调研 | `web_search` `read_article`（用 offset 翻页）`save_webpage` `video_transcript` |
| 登录墙 | `browser_login_status` → `platform_login` |
| 过夜 | `session_goal_set` `session_goal_status` |

## 流程 A — 同步建库

1. 澄清主题 / 受众 / 深度。
2. `garden_list` 查重 → `garden_create`（首页用模板写清目录与阅读路径）。
3. 先建 **目录骨架文**（每篇也要达到质量硬标准的精简版：≥ 800 字或明确标为「导读」且 ≥ 500 字 + 完整阅读路径）。
4. 调研补强：每篇至少读 1 个可靠源再写「来源」。
5. 验收：`post_list` + 抽查字数与链接格式。

## 流程 B — 过夜 Goal

1. 至少完成 `garden_create` + 首页目录意图。
2. `session_goal_set`，目标文案须嵌入质量硬标准与链接格式，例如：

```
目标：花园 {id} 主题「{主题}」达到可阅读初版。
要求：
- 文章 ≥ N 篇，每篇正文 ≥ 800 汉字（综述 ≥ 1200）
- 每篇含：概述、机制（公式或伪码或步骤）、例子/对比、来源外链、相关（Markdown 标题链接，禁止裸 [[slug]]）
- 禁止 write_file 直写 content/；只用 garden_* / post_*
- 禁止批量空壳；单篇失败不中断
完成：抽查 2 篇达标 + 首页目录链接可点到已有文
```

3. 设完 Goal 后立刻开写第一篇深文，勿空转搜索。

## 流程 C — 健康检查

`post_list` + `garden_get`：缺页、短文（<800 字）、裸 `[[slug]]`、断链意图、首页目录与文章不一致 → 报告后经同意再 `post_update`。

## 反模式

- 上游 llm-wiki 的 `install.sh` / Chrome debug / `uvx` / `raw/` 目录
- 一夜只搜不写、或 10 篇 × 150 字「骨架」报完成
- 相关区只有路径气泡没有中文标题链接
