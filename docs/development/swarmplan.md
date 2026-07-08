# Swarm 设计决策清单（v2）

> ✅ = 已确认，⏳ = 待回复，💡 = 我补充解释的新方案

---

## 已确认 ✅

| # | 决策 | 你的回复 |
|---|---|---|
| 1 | 超级 Agent 首次启动自动创建 | ✅ |
| 2 | 管理 Agent 主 session + 可选另开 | ✅ |
| 3 | 管理 Agent 可替子转发消息 | ✅ |
| 4 | 心跳连续失败 3 次邮件通知 | ✅ |
| 6 | 身份注入是软限制 + 工具调用需硬拦截中间层 | ✅ 注入软限制 + 硬中间层 |
| 7 | Memory 私有，只有 inspect 能越级读 | ✅ |
| 8 | 删除 Agent 级联删 session/message/memory | ✅ |
| 9 | 每个 Agent 同时只处理一个流式任务 | ✅ |
| 11 | 运行中用旧配置，下次启动用新配置 | ✅ |
| 13 | LLM 调用需要并发控制 | ✅ |
| 16 | 超级不能删自己/其他 super，删管理需先删子 | ✅ |
| 17 | 所有 Agent CRUD 写 Log 审计 | ✅ |
| 18 | 结构化消息 + 纯文本兼容 | ✅ |
| 19 | 跨 Workspace 只有超级能协调 | ✅ |
| 24 | Agent 进化模仿 Hermes | ✅ |
| 25 | 监控统计：对话轮数/工具执行数/成功率/平均耗时/token | ✅ |
| 23 | Docker + 远程访问 + Cloudflare（以后再说） | ✅ 以后 |

---

## 需要补充解释的 ⏳

### 10. Agent 被删除 → 留 tombstone（墓碑）

你说：先停止再删除，留一个占位的，后续读这个 Agent 状态时能说"在 XX 时候被 YY 删了"。

**具体设计**：
```
Agent 被删除时：
1. 先 abort 运行中的任务
2. session/message/memory 级联删除
3. Agent 记录改为 tombstone：
   - status = "deleted"
   - deletedAt = 时间
   - deletedBy = "user" | agentId | "super"
   - 保留 name/id/tier 不删
4. 其他 Agent 引用已删除 Agent 时 → 返回 tombstone 信息
```

⏳ **追问 10a**：tombstone 保留多久？永远？还是 30 天后彻底清除？

回答：

---

### 12. 循环委托防护（重新解释）

**场景**：超级 Agent 让管理 Agent 做 A 任务 → 管理让子 Agent 做 A → 子 Agent 觉得需要管理帮忙 → 给管理发消息 → 管理又给子发 → 子又给管理发…无限循环，消息来回弹，LLM 一直调，token 烧光。

**类比**：你让同事 A 帮你做事，A 让 B 做，B 找 A 帮忙，A 又找 B…死循环。

**方案**：每条消息带一个 `depth` 计数器，记录这是第几层委托。比如超级→管理是 depth=1，管理→子是 depth=2，子→管理是 depth=3。超过 10 层自动拒绝，返回"委托层级过深，可能存在循环"。

⏳ **追问 12a**：这个方案可以吗？上限设 10 层合理吗？

回答：

---

### 14. 预算耗尽通知

你说：耗尽的时候告诉我。

**方案**：`LLM_DAILY_BUDGET` 耗尽时 → 邮件通知用户 + 所有 Agent 的心跳跳过 + 记录 `budget_exceeded`。不需要"连续 3 次"逻辑，耗尽即通知。

✅ 确认（如果你同意就说"行"）

回答：

---

### 15. Agent 自动休眠（重新解释）

你说：任务执行结束、两个 queue 都空、没有心跳 → 自动休眠。

**方案**：Agent 不需要手动设 dormant。自动状态机：
```
active   ← 有正在执行的任务 或 队列有消息 或 心跳 cron 下次触发时间 < 1h
idle     ← 无任务、队列空、有心跳但还没到触发时间
dormant  ← 无任务、队列空、无心跳（或心跳 disabled）
```
休眠 = idle/dormant，不占资源，不跑 LLM。有消息到达或心跳触发时自动唤醒。

✅ 确认（如果你同意就说"行"）

回答：

---

### 20. Agent 树图标

你说：不能用 emoji 符号，必须 SVG/icon。

**方案**：用 Lucide 图标库（项目已用）：
- Workspace → `FolderOpen` icon
- 超级 Agent → `Crown` icon
- 管理 Agent → `ShieldCheck` icon
- 子 Agent → `Bot` icon

✅ 确认（如果你同意就说"行"）

回答：

---

### 21. 消息气泡位置统一

你说：气泡位置统一。

**方案**：所有 Agent 发来的消息（super/manager/sub/system）统一在**左侧**（和现有 assistant 气泡一样），用**颜色标签**区分来源而非位置：
- user → 右侧蓝色气泡（现有不变）
- super → 左侧气泡 + 顶部紫色标签条「超级 Agent → 管理 Agent」
- manager → 左侧气泡 + 顶部绿色标签条「管理 Agent → 子 Agent」
- system（心跳）→ 左侧气泡 + 顶部橙色标签条「心跳触发」

✅ 确认（如果你同意就说"行"）

回答：

---

## FileBus 重新设计 💡

### 22. FileBus 到底解决什么问题？

**问题**：同一 Workspace 内的多个 Agent 需要共享一些信息——比如爬虫 Agent 抓了数据，编辑 Agent 要读这些数据。它们怎么传递？

**FileBus = Workspace 内 Agent 间的共享文件系统**。

```
workspace.path/                      ← 用户的工作区文件（项目代码、文档等，Agent 用 read_file/write_file 直接操作）
└── .knowpilot/                      ← KnowPilot 内部状态目录（对用户透明）
    ├── log.jsonl                    ← 所有 Agent 操作的审计日志（append-only，不可改）
    ├── shared/                      ← Agent 间共享文件区
    │   ├── data/                    ← 共享数据文件（爬虫存数据、编辑读数据）
    │   └── scratch/                 ← 临时草稿区（Agent 可自由读写）
    └── state.json                   ← 共享状态键值对（Agent 间轻量协调，如"上次爬取时间"）
```

**Agent 通过 3 个工具访问 FileBus**：
- `workspace_log_read` — 读审计日志（了解其他 Agent 做了什么）
- `workspace_state_read` / `workspace_state_write` — 读写共享状态键值对
- `workspace_shared_read` / `workspace_shared_write` — 读写共享文件区

**与现有 `content/` 目录的区别**：
- `content/` = 全局内容源（文章、Agent 配置等），所有 Agent 可用
- `workspace/.knowpilot/` = Workspace 内 Agent 协作专用，跨 Workspace 隔离

⏳ **追问 22a**：这个设计清楚了吗？共享文件区 + 共享状态 + 审计日志三个维度够吗？还是需要更多？

回答：

---

## 新增问题（你让我多想想）💡

### 27. Agent tombstone 保留多久？
tombstone（已删除 Agent 的墓碑记录）是永远保留还是定期清除？

**推荐**：永远保留（占空间极小，只是一个状态标记）。如果担心积累，可设 `AGENT_TOMBSTONE_TTL_DAYS=90`，90 天后彻底清除。

回答：

---

### 28. 管理 Agent 的默认 system prompt 模板？
超级 Agent 创建 Workspace 时自动创建管理 Agent。这个管理 Agent 的 system prompt 是什么？

**推荐**：提供模板，超级 Agent 可自定义覆盖：
```
你是 {workspaceName} 的管理 Agent。
你的职责是管理本 Workspace 内的子 Agent，接收来自超级 Agent 或用户的命令并执行/分配。
你可以创建子 Agent，可以与子 Agent 通信，可以向上级回报结果。
```

回答：

---

### 29. 超级 Agent 的默认 system prompt？
首次自动创建的超级 Agent，system prompt 是什么？

**推荐**：
```
你是 KnowPilot 的超级 Agent，用户的全权代理。
你可以创建 Workspace、创建/编辑/删除任何 Agent。
你通过心跳机制自主运行，定时检查任务并下发命令。
你不可删除自己或其他超级 Agent。
所有操作会被审计记录。
```

回答：

---

### 30. Workspace 创建时自动生成什么文件？
新建 Workspace 时，目录结构是空的还是有模板？

**推荐**：自动创建 `.knowpilot/` 子目录 + 初始化 `log.jsonl`（首条日志"Workspace 创建"）+ `state.json`（空 `{}`）+ `shared/data/` 和 `shared/scratch/` 空目录。

回答：

---

### 31. Agent 工具分配机制？
每个 Agent 的 tools 怎么决定？

**推荐**：
- 超级 Agent：自动拥有所有 swarm 管理工具 + 所有 native 工具
- 管理 Agent：自动拥有 `agent_create_sub` + `agent_send_message` + `agent_report_back` + `agent_forward` + FileBus 工具 + native 工具（可配置增减）
- 子 Agent：创建时由管理 Agent / 用户指定 tools，默认有 `agent_report_back` + FileBus 工具 + 用户选的 native 工具
- 所有 Agent 的 swarm 工具（send_message/inspect 等）由 tier 自动注入，不需手动配

回答：

---

### 32. 队列容量上限？
一个 Agent 的消息队列最多多少条？满了怎么办？

**推荐**：上限 100 条。超限时拒绝新消息并返回错误"队列已满，请先处理已有消息"。心跳触发的消息在队列满时跳过本轮。

回答：

---

### 33. 每个_agent 的 session 列表怎么组织？
当前 Chat 页左侧是全局 session 列表。swarm 模式下每个 Agent 有自己的 sessions。

**推荐**：左侧栏分两层：
- 第一层：Workspace 树 → Agent 节点
- 点击 Agent → 右侧展开该 Agent 的 session 列表（主 session 置顶）
- 全局搜索仍可搜所有 session

回答：

---

### 34. Agent 能修改自己的配置吗？
管理 Agent 能改自己的 system prompt 吗？

**推荐**：不能。只有上级（超级/用户）能修改下级 Agent 配置。Agent 不能自我修改，防止失控。

回答：

---

### 35. 服务器关闭时运行中的任务怎么办？
关机时有 Agent 正在跑任务。

**推荐**：优雅关闭——abort 所有运行中任务 + 标记 `interrupted`。重启后 `recoverStaleAsyncJobs` 把 interrupted 任务标记为 failed（不自动续跑，因为 LLM 上下文已丢失）。

回答：

---

### 36. Workspace 删除时？
删除 Workspace 时里面的 Agent 怎么办？

**推荐**：
1. 先 abort 所有 Agent 的运行任务
2. 删除所有子 Agent（留 tombstone）
3. 删除管理 Agent（留 tombstone）
4. Workspace 记录标记 deleted（保留 path 一段时间供用户取回文件）
5. `.knowpilot/` 目录保留，log.jsonl 记录删除事件

回答：

---

### 37. Agent 名称唯一性？
当前 Agent name 全局唯一。swarm 下要改成 per-Workspace 唯一吗？

**推荐**：保持全局唯一（现有逻辑不变）。建议命名约定：`{workspaceName}-{role}`，如 `techblog-crawler`。

回答：

---

### 38. 心跳用便宜模型，对话用好模型？
Agent 有默认 model。心跳任务能不能用更便宜的模型？

**推荐**：Agent 配置加 `heartbeatModel` 字段（可选）。心跳触发时用 `heartbeatModel`（默认 `deepseek-v4-flash`），用户对话用 `model`（可配 `deepseek-v4-pro`）。省钱。

回答：

---

### 39. Agent 间消息能带附件/文件引用吗？
超级给管理发消息时能附带"看一下这个文件"吗？

**推荐**：可以。消息结构里的 `content` 支持包含文件路径引用，Agent 收到后可自行 `read_file`。不做二进制附件传递（太大），只传路径引用。

回答：

---

### 40. 你还有什么补充？
最后机会，任何方向。

回答：

---
