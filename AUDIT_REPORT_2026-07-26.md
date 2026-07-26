# KnowPilot 架构审计报告（2026-07-26）

> 基于 `AUDIT_PROMPT.md`。验收数字以本轮命令输出为准。

## 执行摘要

本波在 `arch/audit-fix-2026-07-26` 修完审计洞并补完曾注水项。

| 级别 | 项 | 状态 |
|---|---|---|
| P0 | orchestrator UTF-8 编码事故 | **已修** |
| P1 | Resume 单飞 + `claimActiveAbortController` | **已修** |
| P1 | FS 写隔离 / Workspace.path 绕 posts | **已修** |
| P1 | E8 `startNewChat` migrate | **已修** |
| P2 | D7 symlink/Junction 写逃逸 | **已修** `assertWritePathSafe` + realpath |
| P2 | A8 inject 落库失败幻影消息 | **已修**（落库失败不进 LLM；时序拆行仍开放） |
| P2 | A7 reflection 拒稿已流出 | **已修** |
| P2 | B8 在途 dedup + 过期仍在途负向测 | **已修** |
| P2 | P2-4 abort hydrate 假绿 | **已改行为测**（HYDRATE_DONE 不能释放 done） |
| P2 | E7 / tombstone / focusedConfigApi | **已修** |

### 诚实账本

1. 曾报 E8 已修却漏 `startNewChat` migrate。
2. 禁止 PowerShell `Set-Content` 写含 CJK 源码。
3. 禁止抄历史「767」；本轮实测见文末。
4. Workspace 创建 path 现强制在 projectRoot 内（旧测用 `D:/temp/...` 已改 `workspaces/...`）。

---

## 仍开放（低优先级）

| 项 | 说明 |
|---|---|
| A8 时序拆行 | assistant 按轮拆行 / `injectAfterRound`（幻影半已修） |
| C8 config 热更新 | 产品已选不做（改配置重启） |
| E2E | mount sessionStorage 续传 + listRunning 同 session 双挂 |

---

## 验收（本轮实测）

| 包 | 结果 |
|---|---|
| server lint | 通过 |
| shared lint | 通过 |
| web lint | 0 error |
| `@knowpilot/server` test | **113 files / 779 passed** |
| `@knowpilot/web` test | **20 files / 67 passed** |
| `@knowpilot/shared` test | **5 files / 40 passed** |

---

*生成：2026-07-26 · 分支 `arch/audit-fix-2026-07-26`*
