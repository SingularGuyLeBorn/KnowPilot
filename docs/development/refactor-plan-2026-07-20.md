# KnowPilot 重构实施计划（2026-07-20）

> 依据：`docs/development/architecture-audit-2026-07-20.md`（2 P0 + 16 P1 + 19 P2/P3）。
> 灵感来源：loopx（`tmp/references/loopx`，心跳决策层/退避/gate scope/stall 自愈/行为记账）与 pi（`tmp/references/pi`，会话树/context 钩子/compaction 切割）。参考仓库若缺失可按计划末尾「参考仓库」节重新克隆。
> 本文档是给**实施者**（人或 AI agent）的总控计划。每个工单配一份自包含提示词：`docs/development/refactor-prompts-2026-07/*.md`，逐份粘贴给实现 agent 即可。

## 全局规则（所有工单必须遵守）

1. **分支**：每个工单一个分支，从最新 `master` 切出；命名见下表。勤提交（一个子任务一个 commit），commit 前缀 `fix:`/`feat:`/`refactor:`/`test:`，中文信息。
2. **合并条件**（缺一不可）：`pnpm lint` 全绿 + `pnpm --filter @knowpilot/server test` 全绿（涉及 web 的加 `pnpm --filter @knowpilot/web test`）+ 新增负向断言测试通过（能证明修复前会失败）+ 工单验收清单全勾。合并用 `git merge --no-ff` 进 master。
3. **架构纪律**（AGENTS.md 铁律，违反即打回）：
   - 不变量收进 store/reducer/状态转移点；**禁止**编排层时序猜测（`setTimeout`/`queueMicrotask` 赌时序/`await 重新拉取赌落库`/散布的 phase 守卫）。
   - 自检：删掉新加的编排层代码，reducer/条件写还能保证正确吗？不能就是补丁。
   - 禁止向后兼容包袱：改接口就改全仓调用方，禁止兼容重载/双轨分支；数据迁移走一次性脚本。
4. **测试纪律**：每个 bug 修复先写**负向断言测试**（旧实现下红），再改实现变绿；每个新功能配 Vitest 单测（server：`apps/server/src/__tests__/`；web：`apps/web/lib/__tests__/` 或 `components/__tests__/`）。
5. **不要动**：`feat/chat-kimi-composer` 分支及其未提交工作区（用户 WIP）；`tmp/` 下内容不提交。
6. **文档收尾**：每个工单合并时更新 AGENTS.md「当前状态与近期变更」段（一段式，沿用现有格式）；设计权衡写进 `docs/development/design-decisions.md` 文末。

## 执行环境

- 仓库：`D:/ALL IN AI/KnowPilot`。实施可用独立 worktree 避免污染主工作区：
  `git worktree add tmp/worktrees/impl master`，然后 `pnpm install && pnpm --filter @knowpilot/server exec prisma generate`。
- 参考仓库（只读，设计细节可查）：`tmp/references/pi`（TS agent harness）、`tmp/references/loopx`（Python 长循环控制平面）。

## 阶段一：体检修复（6 个 PR，按序或两两无冲突并行）

| PR | 分支 | 提示词 | 内容 | 覆盖发现 | 预估 |
|---|---|---|---|---|---|
| PR-1 | `arch/data-sync-integrity` | 01-data-sync-integrity.md | Markdown↔DB 投影层完整性 | D1(P0) D2(P0) D3 D4 D5 D8 | 大 |
| PR-2 | `arch/approval-circuit-budget` | 02-approval-circuit-budget.md | 审批等待/破坏性清单/断路器/预算 | C3 C6 C5 D6 (+A6) | 中 |
| PR-3 | `arch/heartbeat-scheduler` | 03-heartbeat-scheduler.md | 心跳刷新串行化/僵尸 Task/原子认领/计数器 | C1 C2 C4 C7 | 中 |
| PR-4 | `arch/async-delivery-queue` | 04-async-delivery-queue.md | 投递对账/队列认领/池槽/depth/启动恢复 | B1 B2 B3 B4 B5 B6 B7 | 大 |
| PR-5 | `arch/stream-kernel` | 05-stream-kernel.md | 流式内核不变量（abort/SSE id/compact/起流/注入持久） | A1 A2 A3 A4 A5 (+E3 服务端契约) | 大 |
| PR-6 | `arch/chat-web-store` | 06-chat-web-store.md | Web Chat store 不变量 | E1 E2 E3(web) E4 E5 E6 | 中 |

**依赖与冲突**：PR-1 与 PR-3 都碰 `services.ts`（PR-1 碰 BaseService/FileSyncService 区，PR-3 碰 TaskService.run 区）——建议 PR-1 先合并，PR-3 后 rebase。PR-5 与 PR-6 通过「abort 协议契约」耦合（E3 需要 PR-5 服务端在 stop 响应携带 `partialAssistantMessageId`）——按同一契约并行开发，合并顺序 PR-5 先。PR-2、PR-4 相对独立。

**并行策略**：可两路并行——线路甲：PR-1 → PR-3 → PR-5；线路乙：PR-2 → PR-4 → PR-6。汇合点跑全量 `pnpm validate`（至少 lint+test）。

## 阶段二：五大功能工单（阶段一全合并后开始，严格按序）

| 工单 | 分支 | 提示词 | 内容 | 依赖 |
|---|---|---|---|---|
| W1 | `feat/session-tree` | 07-w1-session-tree.md | 会话树：ChatMessage.parentId + 分支切换 + 书签 + 分支摘要 | 独立（建议 PR-5/PR-6 后） |
| W2 | `feat/heartbeat-decision` | 08-w2-heartbeat-decision.md | 心跳决策层：should-run packet + 退避/reset_token + terminal 停摆 | PR-3 |
| W3 | `feat/approval-scope` | 09-w3-approval-scope.md | 审批 decision-scope + safe fallback + 通知冷却 | PR-2 |
| W4 | `feat/context-hooks` | 10-w4-context-hooks.md | context 钩子链：promptBuilder 注入改每轮钩子 | PR-5 |
| W5 | `feat/compaction-stall-budget` | 11-w5-compaction-stall-budget.md | compaction 切割规则 + stall 自愈 + 行为记账 | W2（stall 复用决策层）、PR-3 |

## 验收总闸

- 阶段一完成：16 个 P1 + 2 个 P0 全部有对应测试与修复 commit；体检报告对应行标注「已修复@commit」。
- 阶段二完成：五个工单各自的验收清单全勾；`pnpm lint` + `pnpm test` 全绿；AGENTS.md 与 design-decisions.md 更新完整。
- 最终建议跑一次 `pnpm validate`（含 e2e）。

## 参考仓库

- pi：`git clone --depth 1 https://github.com/earendil-works/pi tmp/references/pi`（重点：`packages/coding-agent/docs/session-format.md`、`src/core/session-manager.ts`、`src/core/compaction/compaction.ts`、`docs/extensions.md`、`packages/agent/src/agent-loop.ts`）
- loopx：`git clone --depth 1 https://github.com/huangruiteng/loopx tmp/references/loopx`（重点：`loopx/quota.py`、`loopx/control_plane/scheduler/scheduler_hint.py`、`loopx/control_plane/quota/stall_repair.py`、`docs/quota-allocation.md`、`docs/project-agent-todo-contract.md`）
- 网络不稳时 tarball 兜底：`curl -fSL -C - https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/main -o x.tar.gz`
