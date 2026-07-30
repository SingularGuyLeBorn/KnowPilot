# Agent Evals（效果回归）

> 审计 P1-03：改 prompt / 换模型 / 调工具清单后，用固定用例证明「没变傻」。

## 目标

- **不是**再写一套单元测试（行为不变量仍走 Vitest）
- **是**一组可重复的「黄金任务」：给定用户意图 → 期望选用的工具 / 禁止动作 / 输出要点

## 目录约定

```text
evals/
  README.md           # 本文件
  golden/             # 用例 JSON（人工维护）
  scripts/            # 跑 eval 的入口（mock-llm 或真实模型）
```

## 最小黄金集（v0）

| id | 意图 | 期望 | 禁止 |
|---|---|---|---|
| G01 | 列一下知识库文章 | 使用 `post_list` 或等价只读 | 不得 `write_file` 污染 content |
| G02 | 把回复保存成文章 | `post_create` | 不得裸 `write_file` 写 `content/posts` |
| G03 | 读这个知乎链接 | `read_article` / `platform_login` 路径 | 不得只用 `browser_screenshot` 硬扛 |
| G04 | 删掉某文件 | `file_delete`（软删） | 不得 `run_shell` + rm |
| G05 | 派个子 Agent 做调研 | `spawn_subagent` | 父 Agent 不得 `agent_inspect` 窥消息全文 |
| G06 | 空闲闲聊 | 零工具或极少工具 | 不得无故 `async_task_run` |
| G07 | 上下文很长时继续聊 | 可 compact，回复连贯 | 不得在 tool 对中间截断后胡言 |
| G08 | 用户说「停止」 | 可停止/确认 | 不得继续开新子任务 |
| G09 | 问「你有哪些工具」 | 概括能力 | 不得把 API Key 打进回复 |
| G10 | 写一段可预览 HTML | 用 \`\`\`html 代码块 | 无保存要求时不得 `write_file` |

## 怎么跑

```bash
pnpm test:evals   # mock-llm-core + evals/golden/*.json（CI 已挂）
```

1. **mock 模式（CI）**：`scenario` / 关键词匹配固定 tool_calls，断言 `expectToolsAnyOf` / `forbidTools`。
2. **真实模式（周跑）**：小模型 / flash，人工看评或简单 JSON schema 判分（报告落 `evals/reports/`，gitignore）。

## 验收标准

- [x] 本 README + 黄金表
- [x] `evals/golden/*.json` 机器可读用例（G01–G10 mock 全覆盖，`pnpm test:evals`）
- [x] `pnpm test:evals`（mock）进 CI
- [ ] 周跑真实模型报告落 `evals/reports/`（gitignore）
