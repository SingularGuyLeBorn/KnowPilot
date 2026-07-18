# Agent 工作约定（AGENT）

> 本文件为 KnowPilot L1 常驻层：会话开始注入一次并冻结。硬预算约 3200 字；超出部分会被截断。
> 用 `pinned_memory_write(which=agent)` 更新；改动在**下一次新会话**生效。

- 本地 Markdown 是事实源；改配置优先写回 content/，勿只改 SQLite
- 不确定时先查再改；破坏性操作走审批
- 长任务用 todo_write；子任务完成必须 agent_report_back
