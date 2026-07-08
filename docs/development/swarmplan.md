# Swarm 设计决策清单（v3）

> ✅ = 已确认，⏳ = 待回复
> **约定**：不写回答 = 默认同意推荐方案；写了回答 = AI 需调整后再确认

---

## 已确认 ✅


| #  | 决策                                                                         |
| ---- | ------------------------------------------------------------------------------ |
| 1  | 超级 Agent 首次启动自动创建                                                  |
| 2  | 管理 Agent 主 session + 可选另开                                             |
| 3  | 管理 Agent 可替子转发消息                                                    |
| 4  | 心跳连续失败 3 次邮件通知                                                    |
| 6  | 身份注入软限制 + 工具调用硬拦截中间层                                        |
| 7  | Memory 私有，只有 inspect 能越级读                                           |
| 8  | 删除 Agent 级联删 session/message/memory                                     |
| 9  | 每个 Agent 同时只处理一个流式任务                                            |
| 10 | 删除 Agent 留 tombstone（status=deleted + deletedAt + deletedBy）            |
| 11 | 运行中用旧配置，下次启动用新配置                                             |
| 12 | **向上发消息只能在正式回复（无工具调用的最终回复）中，不能在工具调用轮次中** |
| 13 | LLM 调用并发控制                                                             |
| 14 | 预算耗尽即邮件通知，心跳跳过                                                 |
| 15 | Agent 自动休眠：无任务+队列空+无心跳 → dormant，有消息/心跳 → 自动唤醒     |
| 16 | 超级不能删自己/其他 super，删管理需先删子                                    |
| 17 | 所有 Agent CRUD 写 Log 审计                                                  |
| 18 | 结构化消息 + 纯文本兼容                                                      |
| 19 | 跨 Workspace 只有超级能协调                                                  |
| 20 | 图标用 Lucide：FolderOpen/Crown/ShieldCheck/Bot，禁止 emoji                  |
| 21 | 消息气泡统一左侧，用颜色标签条区分来源                                       |
| 23 | Docker + 远程访问 + Cloudflare（以后）                                       |
| 24 | Agent 进化模仿 Hermes                                                        |
| 25 | 监控统计：对话轮数/工具执行数/成功率/平均耗时/token                          |
| 27 | tombstone 永远保留                                                           |
| 28 | 管理 Agent 默认 system prompt 模板                                           |
| 29 | 超级 Agent 默认 system prompt 模板                                           |
| 30 | Workspace 创建时自动生成 .knowpilot/ 结构                                    |
| 31 | 工具按 tier 自动注入 + 可配置增减                                            |
| 34 | Agent 不能自我修改配置                                                       |
| 35 | 优雅关闭：abort 任务 + 标记 interrupted + 重启标记 failed                    |
| 37 | 实体用 UUID/cuid 全局唯一，name 可重复                                       |
| 38 | heartbeatModel 字段，心跳用便宜模型                                          |
| 39 | 消息支持文件路径引用，不做二进制附件                                         |

---

## 需要回复的 ⏳

### 22a. Workspace 内文件怎么存？

你问：workspace 内的文件怎么存？

**设计**：

- Workspace 的 `path` 字段指向磁盘上的一个真实目录（如 `D:\workspaces\techblog`）
- 这个目录就是 Workspace 的文件根——用户的项目文件、文档等直接放这里
- Agent 用现有的 `read_file`/`write_file`/`list_directory` 工具操作这些文件（已有限制：只能在项目根内）
- `.knowpilot/` 子目录是 KnowPilot 内部状态，Agent 通过 `workspace_*` 工具访问
- **不把文件内容存 DB**（文件在磁盘上就是事实源，与 KnowPilot 的 Markdown-first 原则一致）
- 现有的 `File` 实体（L3 已有）可作为 Workspace 文件的索引/元数据缓存，但不存内容

⏳ 这个方案可以吗？

回答：

---

### 32a. 工具执行调用上限？

你问：工具执行调用多少条上限？

**当前**：`maxToolRounds=12`（限制 ReAct 循环轮数，每轮可调多个工具）。

**推荐**：

- `maxToolRounds=12`（轮数上限，不变）
- 新增 `maxToolCallsPerRun=50`（单次 Agent 运行的总工具调用次数上限）
- 超限时 Agent 停止执行，返回"已达到工具调用上限，请简化任务或拆分为子任务"

⏳ 这个方案可以吗？50 合理吗？

回答：改成 168

---

### 33a. Session 列表精细设计

你说：没问题但需要更精细的设计。

**详细设计**：

```
左侧栏布局（swarm 模式）：
┌─────────────────────────┐
│ 🔍 搜索会话…            │
├─────────────────────────┤
│ 📁 技术博客 Workspace    │  ← FolderOpen icon
│   🛡️ 管理 Agent          │  ← ShieldCheck icon（当前选中）
│     └─ 主 session        │  ← 置顶，加 pin icon
│     └─ 会话 2            │
│     └─ 会话 3            │
│   🤖 爬虫 Agent          │  ← Bot icon
│     └─ 主 session        │
│   🤖 编辑 Agent          │
│     └─ 主 session        │
├─────────────────────────┤
│ 👑 超级 Agent            │  ← Crown icon（全局）
│   └─ 主 session          │
├─────────────────────────┤
│ 📁 已归档 Workspace      │  ← 折叠的归档区
└─────────────────────────┘
```

- 点击 Workspace → 展开/折叠其下 Agent 列表
- 点击 Agent → 展开该 Agent 的 session 列表
- 主 session 始终置顶（带 pin 标记）
- 非 swarm 模式（无 Workspace）→ 回退到当前的扁平 session 列表
- 全局搜索可搜所有 Workspace 的所有 session

⏳ 这个布局可以吗？

回答：

---

### 36a. Workspace 删除：归档 vs 彻底删除

你说：默认软删除归档设为不活跃，可选彻底删除。

**设计**：

```
Workspace 删除流程：
1. 用户/超级选择删除方式：
   a. 归档（默认）→ Workspace.status = "archived" + 所有 Agent status = "dormant"
      - 文件保留，.knowpilot/ 保留
      - 不跑心跳，不接收新消息
      - 可随时恢复（status 改回 active）
      - 归档区折叠显示
   b. 彻底删除（需显式选择）→ 
      - abort 所有运行任务
      - 所有子 Agent → tombstone
      - 管理 Agent → tombstone
      - Workspace 记录 → tombstone
      - 磁盘文件保留 30 天（设 TOMBSTONE_FILE_TTL）后清除
      - .knowpilot/ 日志保留
```

⏳ 这个流程可以吗？

回答：

---

## 新增问题 💡

### 41. 向上发消息的时机约束（基于 #12 你的回复）

你说的规则：**子 Agent 觉得需要管理帮忙 → 不行 → 必须在正式回复（不带工具调用的那个）才能发送给上级**。

**我的理解**：

- **向下发消息**（super→manager、manager→sub）：可以在工具调用轮次中通过 `agent_send_message` 工具发送
- **向上发消息**（sub→manager、manager→super）：**只能**在最终正式回复中发送，不能在工具调用轮次中调用 `agent_send_message` 向上级发
- 这天然防止循环委托：子只能在"说完了"的时候给上级发一条，不能中途反复要帮忙

**实现**：`agent_send_message` 工具检查 `toAgent.tier`，如果目标比发送者层级高（如 sub→manager），且当前还在工具调用轮次中（`probe.toolCalls.length > 0`），则拒绝并返回"向上级发送消息只能在最终回复中进行"。

⏳ 这个理解对吗？

回答：对

---

### 42. Agent 运行记录与 Run 实体的关系

当前 `Run` 实体记录每次 Agent 执行。swarm 模式下心跳也会触发 Agent 运行。

**推荐**：

- 心跳触发的运行 → `Run.input` 里标记 `trigger: "heartbeat"`
- 超级下发的命令 → `Run.input` 里标记 `trigger: "super_command"`, `fromAgentId: ...`
- 用户发起的对话 → `trigger: "user"`（现有默认）
- 监控统计面板按 trigger 维度分组展示

⏳ 可以吗？

回答：

---

### 43. 超级 Agent 的心跳默认配置？

首次创建超级 Agent 时，它的心跳是什么配置？

**推荐**：默认 `enabled: true, cron: "0 9 * * *"`（每天早上 9 点），`goal: "检查所有 Workspace 状态，整理待办，如有需要给管理 Agent 下发命令"`。用户可改。

⏳ 可以吗？

回答：

---

### 44. Agent 间消息的权限校验在哪层做？

你说身份注入是软限制，工具调用需要硬拦截中间层。

**推荐**：在 `executeNativeTool` 之前加一个 `SwarmPermissionGuard` 中间件：

```
工具调用 → SwarmPermissionGuard.check(agentTier, toolName, args)
  → 检查 agent 是否有权调用此工具
  → 检查 args 中的目标 agent 是否在允许通信范围内
  → 检查向上发消息的时机约束（#41）
  → 通过 → 执行；拒绝 → 返回权限错误
```

⏳ 可以吗？

回答：返回权限错误 不能只有一个错误码 还需要一个 错误原因 字段

---

### 45. Hermes 式 Agent 进化的具体范围？

你说模仿 Hermes。Hermes PiAgent 的核心是 Skill 自动生成 + 经验积累。

**推荐 Phase 1 只做基础**：

- Agent 执行完任务后，自动总结经验写入 Memory（`kind: "experience"`）
- 管理 Agent 可定期审查子 Agent 的 experience memory，把通用的提炼成 Skill
- 超级 Agent 可跨 Workspace 发现优秀 Skill 并推广
- **不做**：自动 prompt 优化、自动工具发现（更远期）

⏳ Phase 1 只做这个基础范围可以吗？

回答: 搞一个专门的超级 Agent 可跨 Workspace 发现优秀 Skill 并推广只做这一件事 

---

### 46. 监控统计面板的数据来源？

你只要：对话轮数/工具执行数/成功率/平均耗时/token。

**推荐**：这些数据全部从 `Run` 表聚合（已有 `durationMs`/`tokenUsage`/`status` 字段）。

- 新增 `Run.toolCallCount` 字段（记录本次运行调了多少次工具）
- `/dashboard` 页面新增 Swarm 统计区：按 Agent 分组展示上述 5 个指标
- 心跳触发的运行单独统计

⏳ 可以吗？

回答：

---

### 47. 邮件配置？

邮件通知需要一个邮箱配置。

**推荐**：

- `.env` 加 `EMAIL_PROVIDER=agentemail|smtp|none`（默认 none，不启用）
- `EMAIL_TO=user@example.com`（接收通知的邮箱）
- SMTP 模式：`EMAIL_SMTP_HOST`/`EMAIL_SMTP_PORT`/`EMAIL_SMTP_USER`/`EMAIL_SMTP_PASS`
- AgentEmail 模式：用 AgentEmail API，配 `AGENTEMAIL_API_KEY`
- 前端 `/settings` 页加邮件配置区

⏳ 可以吗？

回答：

---

### 48. 免费 API Key 同步具体方案？

你说有个 GitHub 项目收集免费 API key。

**推荐**：

- 需要你提供 GitHub 项目 URL
- 启动时 `scripts/sync-free-keys.ts` 从该项目拉取 key 列表 → 存入 `Credential` 表（`type: "api_key"`, `scope: "llm"`, `metadata: { source: "free", provider: "..." }`）
- Agent 用 `free_api_keys_fetch` 工具获取一个可用 key（轮询分配 + 标记 lastUsedAt）
- `db:sync` 可定时刷新
- key 失效时 Agent fallback 到 env 的 `LLM_API_KEY`

⏳ 你能提供 GitHub 项目 URL 吗？方案可以吗？

回答：你自己多去搜搜 有的 

---
