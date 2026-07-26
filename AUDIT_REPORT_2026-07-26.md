# KnowPilot 架构审计报告（2026-07-26）

> 基于 `AUDIT_PROMPT.md`。本报告记录**实际落地**与**曾注水后补完**的项；验收数字以本轮命令输出为准，不抄历史「767」口号。

## 执行摘要

PR-1~6 / v7~v10 核心不变量整体仍在。本轮在 `arch/audit-fix-2026-07-26` 上继续修洞，并纠正此前交付注水：

| 级别 | 项 | 状态 |
|---|---|---|
| P0 | `swarmOrchestrator.ts` 中文被打成 `????`（git/PS 编码事故） | **已从历史恢复 UTF-8 + 重放 B8** |
| P1 | 多路 SSE 续传互 abort | **已修** resume 单飞 + `claimActiveAbortController` CAS |
| P1 | FS 写隔离 / Workspace.path 绕过 posts | **已修** `resolveAgentFsPath` + `assertAbsNotKnowledgeCore` + provision 入口校验 |
| P1 | E8 `startNewChat` 创建真实 session 未 `migrateSessionConfig` | **已修**（此前只修了 bindMain / runStream，**漏了新对话按钮路径**） |
| P2 | E7 镜像 / tombstone / B8 在途 dedup | **已修** |
| P2 | A7 reflection 拒稿已流出 | **已修**（服务端缓冲 + 前端清流；默认 reflection 仍关） |
| P2 | 假绿：`focusedConfigApi` / pane 上报残留 | **已清**（secondary pane 误传 prop 已删） |

### 诚实账本（此前翻车）

1. **报告写「E8 已修」但 `startNewChat` 仍无 migrate**——config 写在 `__new__`，点「新对话」建出真实 id 后切片未迁，属注水。
2. **PowerShell / 非 UTF-8 写中文源码**会把注释打成 `????`；禁止再用 `Set-Content` 改含 CJK 文件。
3. **「767/767」不得复用旧数字**——以本轮 `pnpm test` 输出为准（见文末验收段）。
4. **源码扫描假绿**（只 assert 字符串存在）不算验收；已补行为测：FS 负向、workspace path、claim AC、migrate from LS。

---

## 已确认稳固（证据）

- Chat：`BEGIN_STREAM` occupied 拒绝 / `COMMIT_STREAM` 仅 done|error / `ABORT_STREAM` 三态 — `useStreamLifecycle.ts`
- 投递：`ackThenMarkDelivery`、reconciler、`deliveryExempt`、重启 Task 一律 failed
- Swarm：`invoke_api` 已删；`agent_inspect` 不返消息 content
- Schema：`reentrant`/`maxRetries`/`retryCount` 已删

---

## 本轮关键文件（摘要）

- `apps/server/src/infra/swarmOrchestrator.ts` — UTF-8 + B8 lookup/摊销清理保留在途
- `apps/server/src/infra/safePath.ts` — `assertAbsNotKnowledgeCore` / `assertWorkspacePathAllowed`
- `apps/server/src/infra/tools/native/fs.ts` — 写路径落点断言
- `apps/server/src/infra/workspaceProvision.ts` — 创建前 path 校验
- `apps/web/lib/sessionConfigStore.ts` / `useChatRunStream.ts` / `useSessionComposeState.ts` / `chat.tsx`
- 测试：`nativeTools` write 负向、`workspacePathGuard`、`claimActiveAbortController`、`sessionConfigStore` LS migrate

---

## 仍开放（低优先级）

| 项 | 说明 |
|---|---|
| A8/C8/D7 | 扁平 inject / config 热更新 / symlink |
| E2E | mount sessionStorage 续传 + listRunning 同 session 双挂（单测已盖 CAS） |

---

## 验收（本轮实测）

| 包 | 结果 |
|---|---|
| `@knowpilot/server` lint (`tsc --noEmit`) | 通过 |
| `@knowpilot/shared` lint | 通过 |
| `@knowpilot/web` lint (eslint) | 0 error（修前 1 unused-import warning 已清） |
| `@knowpilot/server` test | **112 files / 774 passed** |
| `@knowpilot/web` test | **20 files / 68 passed** |
| `@knowpilot/shared` test | **5 files / 40 passed** |

---

*生成：2026-07-26 · 分支 `arch/audit-fix-2026-07-26`*
