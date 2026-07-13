# KnowPilot 架构修复任务提示词 v2（2026-07-13 深夜接力）

> **使用方式**：本文件整篇交给执行者。v1（`architecture-fix-prompt-2026-07.md`）仍是 W6~W12 的详细工单依据，本文件是**增量指令 + 状态同步 + 新铁律**，优先级高于 v1 中与之冲突的任何表述。
> 审查报告：`docs/development/architecture-audit-2026-07.md`

---

## 0. 当前状态（已核实）

**分支 `fix/p0-agent-budget-hitl`，W1~W5 已提交并验收**：

| 工单 | Commit | 验收状态 |
|---|---|---|
| W1 审批审计 | `f2f889d4` | ✅ lint/test 绿，新测试 approvalAudit 3 例 |
| W2 LLM 弹性客户端 | `a4faf89b` | ✅ lint/test 绿，新测试 resilientLlmClient 14 例 |
| W3 Chat drain 收口 | `209ac858` | ⚠️ 架构达标，**但引入 1 个 e2e 回归，见 §1（P0 必修）** |
| W4 打断循环依赖 | `a60511aa` | ✅ lint/test 绿，新测试 importOrder；**但留了兼容 re-export，见 §2** |
| W5 MemoryRepository | `3fc4be4d` | ✅ lint/test 绿（352+35 全过），新测试 memoryRepository |

**工作区当前**：除 3 个历史遗留的 `content/posts/*.md` 删除（用户有意删除，不要动）外干净。3 个 web 文件显示 modified 仅是 CRLF/LF 行尾差异，无实际内容改动。

---

## 1. P0（先做，阻塞其他一切）：修复 W3 引入的 async-task-mock 回归

**现象**：`apps/web/e2e/async-task-mock.spec.ts`「async_task_run 后台任务完成后结果自动插入对话」稳定失败（4 轮跑 3 轮挂它，另 1 轮挂 subagent-mock 的流式完成等待，同一根因路径）。失败点：`async-progress-step`（左侧异步任务进度步骤）10 秒内不出现。

**根因方向（请先证实再动手）**：W3 把 Compose drain 收口为 INV-8 的四个显式触发事件（用户入队 / onStreamCommitted / 会话切换完成 / HYDRATE_DONE）。**异步任务交付（async_job_update / subagent_session_update 推送 → consumeAsyncDelivery → 进度步骤渲染）这条 consume 链大概率没有被挂进这四个显式事件**，导致推送到了但 UI 不消费。这正好印证 AGENTS.md 铁律：「删掉编排层补丁，bug 复现 = 不变量没收进 store」——现在 bug 复现了，说明 async delivery 的触发在旧补丁里、没进 reducer 的显式事件体系。

**修法要求（铁律）**：
1. 把「async delivery 到达」定义为第五个显式触发事件（或归入 onStreamCommitted 同款钩子体系），在 `useStreamLifecycle.ts` 的 reducer/钩子层接线，**不许**在 chat.tsx 加 `useEffect` 监听 async 队列长度来触发 consume——那就是把删掉的补丁换个名字加回来。
2. 先写一个能复现失败的最小场景（mock e2e 或 vitest），修完让它变绿。

**验收**：
```bash
cd apps/web
pnpm run test:e2e:mock:prep   # build:mock（改了 web 代码必须重建，否则测的是旧构建）
pnpm run test:e2e:mock        # 全量 18 例必须全绿
```
⚠️ **注意**：mock 套件用 `playwright.config.mock.ts`（端口 3011 + MOCK_LLM/MCP/NATIVE_TOOLS），**不是**默认 config；`playwright test <文件名过滤器>` 在该配置下不过滤、每次都跑全量 18 例，别浪费时间调过滤参数。改了 server 代码不用重建，改了 web 代码必须 `test:e2e:mock:prep`。

---

## 2. P1：兼容性债务清零（新铁律，已写入 AGENTS.md）

**AGENTS.md 已新增「架构纪律：禁止向后兼容包袱」一节（与「禁止打补丁」同级铁律），先读。** 本项目单用户、本地优先、未发布 1.0、SQLite 只是缓存层——没有任何「旧版本客户端」需要兼容。以下现存兼容层全部拆除：

| # | 位置 | 债务 | 清理动作 |
|---|---|---|---|
| C1 | `apps/server/src/infra/agentRuntime.ts:20-28` | W4 留下的「兼容 re-export」promptBuilder/agentResolver | 全仓 import 直连 `./promptBuilder.js` / `./agentResolver.js`，删 re-export 块 |
| C2 | `apps/server/src/infra/nativeTools.ts` | `ensureNativeToolsRegistered` 双轨兼容注册层（~80 个遗留 handler 走 `TOOL_HANDLERS` 灌注册表） | **随 W6（PR-4b/4c）一并拆除**：所有 handler 迁完域模块后，删 `TOOL_HANDLERS`/`NATIVE_TOOL_DEFINITIONS`/`ensureNativeToolsRegistered`，注册只留 `registerNativeDomains()` 一条路径 |
| C3 | `nativeTools.ts:1561` 附近 | memorySearchTool「page 参数保留兼容但不再翻页」 | 删 page 参数，调用方同步改 |
| C4 | `nativeTools.ts:1897` 附近 | 「无 prisma 时保持向后兼容」分支 | 删分支；ctx.prisma 缺失直接报错（那是编程错误不是兼容场景） |
| C5 | `services.ts:1337` 附近 | 「单 agentId 兼容旧调用方」 | 统一为 agentIds 批量模式，调用方同步改 |
| C6 | 全仓扫描 | 其他 `兼容\|legacy\|LEGACY\|deprecated\|backward` 注释及对应分支 | 逐条按同样标准清理；判断标准：这个兼容层服务的「旧版本」在哪台机器上运行？答不出就删 |

**纪律**：清理兼容层时必须同 commit 改完全部调用方；宁可 lint 红着改完，不留半截双轨。测试里引用旧接口的同步更新（不是删测试）。

---

## 3. P2：继续 v1 剩余工单（W6~W12）

按 v1 `architecture-fix-prompt-2026-07.md` §2 的工单详情执行，优先级不变：W6（PR-4b/4c + rollback，含 C2）→ W7（反思装饰器）→ W8（常量化）→ W9（AgentFactory）→ W10（SwarmOrchestrator）→ W11（Run 活状态 + AWAITING_HUMAN）→ W12（断路器 + 审批清理定时化）。

**v1 纪律全部延续**：每工单独立 commit（`refactor: [W{n}] 中文描述`）；零新增 globalThis 状态 / 动态 import 躲环 / 裸模型名 / 编排层时序补丁；工单内先测试后实现。

---

## 4. 接力须知（发生过的事，避免踩同一个坑）

1. **工作区曾被并发编辑合并过一次**：W4 进行中另一进程做 pre-W3 对照实验回退过 4 个文件（chat.tsx、useStreamLifecycle.ts、useSessionMessages.ts、nativeTools.ts），随后用三方合并恢复（base=pre-W3, ours=W3, theirs=你的 W4 编辑）。`nativeTools.ts` 第 2047 行附近有一行合并修补（`ctx.resolveAgent ?? defaultResolveAgent` 模式，与你在 2623 行的写法对齐）。当前工作区 = W5 提交状态 + 你的 WIP，三方合并结果已随 W4/W5 提交固化，无需再处理，知情即可。
2. **e2e 两套配置别搞混**：真实 LLM 套件 = 默认 `playwright.config.ts`（3010）；mock 套件 = `playwright.config.mock.ts`（3011，需先 `test:e2e:mock:prep` 构建）。改了 web 代码跑 mock 套件前**必须重建**。
3. **别动工作区里 3 个 `content/posts/*.md` 的删除**——是用户有意删的，不是事故。
4. **行尾警告忽略**：Windows 下 `LF will be replaced by CRLF` 是仓库既有状态，不要为此格式化全文件制造噪音 diff。

## 5. 完成定义（更新版）

- [ ] §1 P0 回归修复，mock e2e 18 例全绿
- [ ] §2 C1~C6 兼容债务清零（C2 随 W6）
- [ ] W6~W12 按 v1 完成
- [ ] `pnpm validate` 全绿
- [ ] 更新 `architecture-audit-2026-07.md` 维度状态 + `AGENTS.md`「当前状态与近期变更」
- [ ] 提交信息前缀延续 `refactor: [W{n}]` / `fix: [W3-regression]` / `refactor: [compat]`
