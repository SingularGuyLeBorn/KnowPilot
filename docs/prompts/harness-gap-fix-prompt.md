# KnowPilot Harness 工程缺口修复 Prompt

> 本 Prompt 供另一位开发者 / AI 按图施工。修复目标：把 KnowPilot 的 Agent Harness 从「主要靠 prompt 约束 + 人审」升级到「机械化约束 + 自动化验证 + 上下文可控」。
>
> 请严格按 P0→P1→P2→P3 的顺序推进，每个 P 完成后必须跑过 lint + server test + web test，再进入下一个 P。

---

## 项目背景

KnowPilot（见微 / OasisMind）是一个单用户、本地优先的 AI 数字花园，技术栈：

- 后端：Express + tRPC + Prisma + SQLite，`apps/server/src`
- 前端：Next.js 16 + React 19 + Tailwind，`apps/web`
- Agent 运行时：`apps/server/src/infra/loop/reactLoop.ts`、`apps/server/src/infra/agentStream.ts`
- 工具注册与执行：`apps/server/src/infra/nativeTools.ts`、`apps/server/src/infra/tools/native/*.ts`
- Agent 模板：`config/agents/_templates/{super,manager,sub}.md`
- 上下文钩子：`apps/server/src/infra/contextHooks.ts`
- 权限与编排：`apps/server/src/infra/swarmPermissionGuard.ts`、`apps/server/src/infra/swarmOrchestrator.ts`

已落地：Agent 三 tier 身份、Swarm 编排、审批、工具死循环熔断、记忆分层、工具回滚、会话恢复等。

参考文章：《AI Agent 时代的驾驭工程实战指南》（Harness Engineering），核心观点：

1. Agent = Model + Harness，模型决定上限，Harness 决定下限。
2. 约束必须能被**机械化执行**（mechanically enforced），不能只写在 prompt 里。
3. 上下文窗口超过 ~40% 后质量下降，需要监控 + context reset。
4. Agent 身份模板应该是「地图式目录」，分层为：超级红线 / 错误记录 / 操作建议。

---

## 修复总目标

让 Agent 的产出在落盘前被自动验证，让长任务运行时上下文可控，让身份约束更清晰、更少依赖模型自觉。

---

## P0（最高优先级）：自动化产出验证门（Gate）

### 问题

当前 `write_file` / `post_create` / `post_update` 等落盘工具执行后，**不会自动跑校验**。Agent 代码/文章看起来对，但可能 frontmatter 非法、数学公式用了 Unicode 伪符号、TypeScript 语法错误等。只能靠人审或 Agent 自觉发现。

### 要做什么

新增一个叶子模块 `apps/server/src/infra/outputValidator.ts`，并在落盘工具执行后调用它。验证失败时：

1. 不真正落盘（或把文件移入 `.trash/` 临时区）。
2. 把结构化错误返回给 Agent，让它根据错误修复后再写。
3. 错误信息格式要让 LLM 能直接看懂：「错在哪、怎么修」。

### 具体校验规则（V1 先做这些）

| 文件类型 | 校验项 | 错误示例 | 修复提示 |
|---|---|---|---|
| `.md` / frontmatter | YAML frontmatter 合法、必须字段存在 | `title` 缺失 | 请在 frontmatter 补 `title: "..."` |
| `.md` 公式 | 禁用 Unicode 伪公式符号：√ ₖ ᵀ · Σ ≈ 等 | `√d_k` | 改为 ` $\sqrt{d_k}$` |
| `.ts` / `.tsx` | 语法可通过 `tsc --noEmit --skipLibCheck` | `const x =` | TypeScript 语法错误，请补全 |
| `.ts` / `.tsx` | ESLint 不阻塞，但把 warning 汇总返回 | — | 可选：给出 lint 提示 |
| `.md` 图片路径 | 相对路径指向 `content/uploads/` 或可访问位置 | `![](C:\\...)` | 请把图片放入 `content/uploads/` 并用相对路径 |

### 接入点

1. `apps/server/src/infra/tools/native/fs.ts`：`writeFileTool` / `appendToFileTool` 执行落盘前调用 `outputValidator.validate(filePath, content)`。
2. `apps/server/src/infra/tools/native/memory.ts`：`memory_create` / `memory_update` 落盘 Markdown 前校验 frontmatter。
3. `apps/server/src/infra/tools/native/post.ts`：`post_create` / `post_update` 已经过 Service，**额外**在 Service 层前置校验，不要破坏现有 Service 事务。

### 验收标准

- `outputValidator.ts` 独立成文件，纯函数为主，不依赖 prisma。
- 新增 `__tests__/outputValidator.test.ts`，覆盖：
  - Markdown 含 Unicode 伪公式 → 返回错误并提示正确写法。
  - TypeScript 语法错误文件 → 返回错误。
  - 合法 Markdown / 合法 TS → 返回 `{ ok: true }`。
- 验证失败时，调用工具返回 `success: false` + `error` 字段，LLM 能看到修复建议。
- `pnpm --filter @knowpilot/server test -- --run` 全绿。

### 关键设计原则

- **验证器本身不能抛未处理异常**；任何内部错误都视为 `ok: true` 并 warn，不能 blocker 正常写文件。
- 校验失败的信息要**可执行**，不要只写「格式不对」，要写出「应该怎么改」。
- 不要为所有文件类型做校验，V1 只覆盖上表中的类型。

---

## P1（高优先级）：上下文利用率监控 + Context Reset

### 问题

当前 `reactLoop` 不监控上下文窗口，也不做 context reset。长任务运行到后面，模型容易「上下文焦虑」——忘记初始目标、开始兜圈子、提前收尾。

### 要做什么

1. 在 `reactLoop` 每次 round 开始时估算当前 `messages` 的 token 数。
2. 当 token 数超过某个阈值时，触发 `context reset`：
   - 把当前关键状态（standing goal、已确认约束、待办、最近工具结果摘要）提取成结构化「交接文档」。
   - 清空旧 messages，保留 system prompt + 交接文档 + 最后一条 user/assistant 消息。
   - 继续执行。

### 实现建议

- token 估算可用简单字符数估算：`tokens ≈ totalChars / 3.5`，够用了，不要引入 tiktoken 依赖。
- 阈值默认取当前模型 context window 的 40%，可从 `llmClient` 的模型配置里读 `contextWindow`；读不到默认 81920（约 32K token）。
- 交接文档用 Markdown 列表，字段：
  - `goal`: 当前目标文本
  - `constraints`: 已确认必须遵守的约束（从 system prompt 提取或运行时记录）
  - `todo`: 待办列表
  - `recentSummary`: 最近 3-5 轮做了什么
  - `pendingQuestions`: 等待用户/外部回答的问题

### 接入点

- `apps/server/src/infra/loop/reactLoop.ts`：在 `onRoundStart` 或每轮 LLM 调用前检查。
- 不要改 `contextHooks.ts` 的接口；context reset 是 reactLoop 的运行时策略。

### 验收标准

- 新增 `__tests__/contextReset.test.ts`：
  - 模拟 messages 超长，验证 reset 后保留 system prompt、goal、最后一条消息。
  - 验证 reset 不会丢失必须遵守的硬性约束（比如「禁止 write_file 写 content/posts/」）。
- 添加 `AGENT_CONTEXT_RESET_THRESHOLD=0.4` 环境变量支持（可选，默认 0.4）。
- `pnpm --filter @knowpilot/server test -- --run` 全绿。

---

## P2（中优先级）：Agent 模板分层瘦身

### 问题

当前 `super.md` 178 行、`manager.md` 153 行，所有规则平铺。LLM 容易「选择性遵守」，重要红线淹没在细节里。

### 要做什么

把三个模板改成「地图式 + 分层约束」：

```markdown
# 你是 xxx

## 超级红线（违反即严重事故）
- 禁止删除自己或其他 super。
- 禁止用 write_file 直写 content/posts/；写文章必须走 post_create/post_update。
- 子 Agent 结果只能经 agent_report_back 投递；禁止读取子会话消息。
- ...（控制在 5-10 条）

## 错误记录（运行时沉淀的教训）
<!-- 初始为空；Agent 运行时反复踩坑后由进化层追加 -->

## 你的职责
- 编排优先，亲自执行其次。
- ...

## 操作参考
- 知识库花园：...
- 平台登录态：...
- 数学公式规范：...
```

### 具体任务

1. 重写 `config/agents/_templates/super.md`：
   - 正文压到 100 行以内（不含 frontmatter）。
   - 把「数学公式表」「Inbox 流程」「平台登录流程」移到独立的 `docs/agent-guides/` 子文档，模板里只留链接/一句话说明。
2. 重写 `config/agents/_templates/manager.md`：
   - 同样压到 100 行以内。
   - **默认不配置 `write_file`/`post_create`/`read_article` 等执行工具**，只保留调度、审查、汇报、派生子 Agent 的工具。执行必须派 sub。
3. 重写 `config/agents/_templates/sub.md`：
   - 聚焦「接到任务 → 独立执行 → report_back 交结果」。
   - 明确禁止事项（不能派生子 Agent、不能创建 Workspace）。

### 验收标准

- 三个模板正文（不含 frontmatter）均 ≤ 100 行。
- `manager.md` 的 `tools` 列表移除执行类工具；保留的工具调用不破坏现有测试。
- 新增/更新的测试：`agentFactory.test.ts` 检查模板渲染后长度；`trpcSmoke.test.ts` 确保 Agent chat 不崩溃。
- `pnpm --filter @knowpilot/server test -- --run` 全绿。

---

## P3（长期）：错误 → 红线自动进化闭环

### 问题

当前有 drift 检测（`agent.driftStatus`）和 warn，但没有把「反复犯的错」自动沉淀为 Agent 的约束。

### 要做什么

当某个 Agent 反复触发同类错误时，把该错误写入该 Agent/Workspace 的 memory 或一个专门的「错误记录」文件，下次运行前作为「错误记录」注入到 system prompt。

### 触发条件（V1）

- 同一个 Agent 在 7 天内 ≥3 次被 `outputValidator` 拦下同类错误（如「用 write_file 写 content/posts/」）。
- 或同一个 Agent 被 `swarmPermissionGuard` 拒绝同类越权 ≥3 次。

### 存储位置

- 优先存到 `config/memories/_constraints/{agentId}.md`（Git 跟踪，可人工编辑）。
- 格式：
  ```markdown
  ---
  agentId: xxx
  updatedAt: 2026-08-03
  ---
  ## 已升级为红线的错误
  - [2026-08-03] 反复用 write_file 直写 content/posts/；已强制改为必须走 post_create。
  ```

### 接入点

- `apps/server/src/infra/outputValidator.ts`：验证失败时调用 `constraintEvolution.recordViolation(agentId, errorCode, context)`。
- `apps/server/src/infra/contextHooks.ts`：新增一个钩子 `constraint-evolution`，order 150，读取 `_constraints/{agentId}.md` 并注入到 system prompt 的「错误记录」层。

### 验收标准

- 新增 `__tests__/constraintEvolution.test.ts`：
  - 同一错误触发 3 次后生成约束文件。
  - 约束文件内容会被 contextHooks 注入到 system prompt。
- `pnpm --filter @knowpilot/server test -- --run` 全绿。

---

## 全局纪律

- **禁止打补丁**：每个修复必须把不变量收进 reducer / store / 验证器，不能靠 `setTimeout` / `await hydrate` / `phase === 'xxx'` 猜时序。
- **禁止向后兼容包袱**：改接口就改全仓调用方，不要留 deprecated 分支。
- **状态在内存，推拉结合**：任何管理页/Chat 侧状态变化必须走 SSE / hub push + DB pull，禁止让用户刷新页面当修复。
- **提交前必须**：
  - `pnpm --filter @knowpilot/server lint`
  - `pnpm --filter @knowpilot/web lint`
  - `pnpm --filter @knowpilot/server test -- --run`
  - `pnpm --filter @knowpilot/web test -- --run`
- **按主题拆分提交**：基础设施 / 验证器 / context reset / 模板重构 / 进化闭环 分开 commit，不要一锅端。

---

## 可选：先只做 P0

如果时间和人力有限，**只落地 P0（outputValidator）** 就能显著降低 Agent 产出错误的概率，性价比最高。P1-P3 可以后续按顺序补齐。
