# Swarm 设计决策清单

> 每条问题后面有 `回答：` 占位，请逐条回复。
> 标注 ✅ 的为已确认项（上一轮确认的 5 项），可跳过。

---

## 已确认 ✅

1. ✅ 超级 Agent 首次启动自动创建（类似 root）
2. ✅ 管理 Agent 有"主 session"接收命令，用户对话可选择另开 session
3. ✅ 管理 Agent 可替子 Agent 向超级转发消息
4. ✅ 心跳连续失败 3 次后邮件通知用户
5. ✅ Workspace 的 FileBus 用 `.knowpilot/` 子目录结构

---

## Agent 身份与上下文

### 6. Agent 如何知道"自己是谁"？
每个 Agent 需要在 system prompt 里自动注入身份信息（层级、可通信对象、权限）。

**推荐**：`agentStream` 构造 messages 时自动在 system prompt 前注入：
```
你是 {name}，层级 {tier}，属于 Workspace {workspaceName}。
你可以向 {可通信Agent列表} 发送消息。
你 {可以/不可以} 创建子 Agent。
```

回答：

---

### 7. Agent 的 memory 隔离？
管理 Agent 能读子 Agent 的 memory 吗？超级能读所有吗？

**推荐**：不能。每个 Agent 的 memory 私有。只有 `agent_inspect` 工具能越级读取完整上下文（含 memory）。

回答：

---

### 8. Agent 被删除后的记忆？
删除 Agent 后，session/message/memory 级联删除还是归档？

**推荐**：级联删除 session/message/memory，Log 表保留操作审计记录。

回答：

---

## 并发与生命周期

### 9. 一个 Agent 能同时处理多个任务吗？
超级给管理发了 3 条命令，并行还是排队？

**推荐**：每个 Agent 同时只处理一个流式任务，后续命令进 session 队列排队。心跳触发的任务与用户/超级的命令共享同一个队列。

回答：

---

### 10. Agent 正在执行任务时被删除？
管理 Agent 正在跑任务，用户或超级删除了它。

**推荐**：先 abort 运行中的任务，再级联删除。

回答：

---

### 11. Agent 配置更新时正在运行？
超级更新了子 Agent 的 system prompt，但子 Agent 正在执行任务。

**推荐**：运行中的任务用旧配置跑完，下次启动才用新配置。

回答：

---

### 12. 循环委托防护？
超级→管理→子→管理→超级…无限循环。

**推荐**：每个消息带 `depth` 计数器，超过 10 层自动拒绝。

回答：

---

## 心跳与资源

### 13. 心跳并发限制？
50 个 Agent 心跳同时触发 → 50 个并发 LLM 调用。

**推荐**：全局心跳并发上限 = `asyncJobs.maxConcurrent`（默认 2），心跳任务走 orchestrator 排队。可选：同 cron 的 Agent 启动时加随机 delay 错峰。

回答：

---

### 14. 心跳的 LLM 成本控制？
自主心跳持续消耗 token。

**推荐**：复用 `LLM_DAILY_BUDGET`，预算耗尽时心跳跳过 + 记录 `budget_exceeded`，连续 3 次邮件通知。

回答：

---

### 15. Agent 休眠/唤醒？
有些 Agent 临时不需要心跳。

**推荐**：Agent 加 `status: active | dormant`。dormant 不跑心跳、消息排队等唤醒。

回答：

---

## 安全与审计

### 16. 超级 Agent 破坏性操作护栏？
超级被 prompt injection → 删除所有 Agent。

**推荐**：
- 超级不能删除自己
- 超级不能删除其他 super tier Agent
- 删除管理 Agent 需先删除其所有子 Agent
- 可选 `AGENT_DESTRUCTIVE_APPROVAL=true` 时删除走审批

回答：

---

### 17. Agent 操作审计？
超级自动创建/删除 Agent，需要可追溯。

**推荐**：所有 Agent CRUD 写 Log 表，`component="swarm"`，metadata 含操作者/目标/前后状态。管理页有审计日志查看。

回答：

---

## 消息与通信

### 18. Agent 间消息格式？
纯文本还是结构化？

**推荐**：结构化 + 纯文本兼容：
```json
{ "type": "command|query|report|forward", "content": "...", "taskRef": "...", "depth": 3 }
```
Agent 收到后 `formatQueueItemForLlm` 格式化为 LLM 可读文本。

回答：

---

### 19. 跨 Workspace 通信？
Workspace A 的管理能给 Workspace B 的管理发消息吗？

**推荐**：默认不能。只有超级能跨 Workspace 协调。未来可加 `workspace_collaborate` 工具。

回答：

---

## 前端与 UX

### 20. 用户如何选择跟哪个 Agent 聊天？
swarm 模式下 Agent 很多。

**推荐**：左侧栏改为 Workspace 树 → Agent 节点：
```
📁 技术博客 Workspace
  🤖 管理 Agent
    💬 子 Agent（爬虫）
    💬 子 Agent（编辑）
🤖 超级 Agent（全局）
```
点击 Agent 节点进入对话，每个 Agent 有自己的 session 列表。

回答：

---

### 21. Agent 间消息在前端怎么显示？
区分消息来源。

**推荐**：消息气泡加来源标签：
- user → 右侧蓝色气泡（现有）
- super → 左侧气泡 + 🟣 紫色标签
- manager → 左侧气泡 + 🟢 绿色标签
- system（心跳）→ 左侧气泡 + ⚡ 标签

回答：

---

## FileBus 重新设计

### 22. FileBus 具体结构？
之前方案太粗糙，重新设计：

```
workspace.path/
└── .knowpilot/
    ├── log.jsonl          ← append-only 审计日志
    ├── state.json         ← 共享键值状态（Agent 间可读写，乐观锁）
    ├── inbox/             ← 消息归档（消费后从 DB 移到文件）
    ├── tasks/             ← 任务定义
    └── agents/            ← Agent 配置快照
```

**关键**：`state.json` 是 Agent 间共享白板，`log.jsonl` 不可变审计流。Agent 通过 `workspace_read_state` / `workspace_write_state` / `workspace_read_log` 工具访问。

回答：

---

## 其他可能遗漏的方向

### 23. 部署相关？
Docker、远程访问、多用户支持？

回答：

---

### 24. Agent 进化相关？
自我改进、Skill 自动生成、经验积累？

回答：

---

### 25. 监控相关？
Agent 健康度、性能指标、任务统计面板？

回答：

---

### 26. 你还想补充的其他问题？
任何我没覆盖的方向。

回答：

---
