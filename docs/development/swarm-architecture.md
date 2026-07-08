# KnowPilot Swarm 架构设计

> 分支：`feat/swarm-architecture`
> 状态：设计阶段（未实现）
> 日期：2026-07-08

---

## 1. 终极目标

让 KnowPilot 脱离用户干预，通过心跳机制自主运行：
- 超级 Agent 定时启动任务，下发命令给下级 Agent
- Agent 间分层协作，自动创建/管理下级 Agent
- 任务完成通过邮件通知用户
- 用户可随时介入任何层级，也可完全不介入

---

## 2. 三层 Agent 层级

```
用户（最高权限，可控制任何 Agent）
  │
  ▼
超级 Agent（Super Agent）
  · 只有用户能控制
  · 对所有 Agent 有完整 CRUD + 编辑权限
  · 可创建 Workspace（创建后自动生成该 Workspace 的管理 Agent）
  · 心跳机制：定时启动，自主决策
  │
  ▼  ↕ 双向通信
管理 Agent（Manager Agent）—— 每个 Workspace 一个
  · 只有用户和超级 Agent 能控制
  · Workspace 内的天神：可创建/管理子 Agent
  · 可与用户聊天，可接收超级 Agent 下发的命令
  · 心跳机制：定时启动
  │
  ▼  ↕ 双向通信
子 Agent（Sub Agent）—— Workspace 内多个
  · 管理 Agent 控制（超级 Agent + 用户也可越级直接指挥）
  · ❌ 不能给超级 Agent 发消息（向上跨级禁止）
  · 做实际工作
```

### 通信规则

| 发起方 → 接收方 | 允许？ | 说明 |
|---|---|---|
| 用户 → 任何 Agent | ✅ | 越级指挥，最高权限 |
| 超级 → 管理 | ✅ | 下发命令 |
| 超级 → 子 | ✅ | 越级直接指挥 |
| 管理 → 超级 | ✅ | 回报结果 |
| 管理 → 子 | ✅ | 分配任务 |
| 子 → 管理 | ✅ | 回报结果 |
| 子 → 超级 | ❌ | 禁止跨级上报 |

### 消息队列规则

- 用户发送的消息和超级 Agent 发送的消息进入**同一个队列**
- 每条消息标注来源：`source: "user" | "super" | "manager"`
- 队列是 **session 级隔离**（每个 Agent 对话有独立队列）
- 切换 Agent 对话窗口**不中断**心跳消息和未完成的队列消费
- 异步任务结果队列优先级 > 消息队列（已实现）

---

## 3. 数据模型扩展

### Agent 增加层级字段

```prisma
model Agent {
  // ...现有字段...
  tier         String   @default("sub")    /// "super" | "manager" | "sub"
  workspaceId  String?                       /// 所属 Workspace（super 无）
  parentId     String?                       /// 上级 Agent id（super 无）
  apiKey       String?                       /// 专属 API Key（不设则用 env）
  heartbeat    Json?                         /// 心跳配置 { enabled, cron, goal, lastRunAt }
  // 关系
  workspace    Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)
  parent       Agent?     @relation("AgentHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children     Agent[]    @relation("AgentHierarchy")
}
```

### Workspace 增加管理 Agent 关联

```prisma
model Workspace {
  // ...现有字段...
  managerAgentId String?  /// 该 Workspace 的管理 Agent id
  managerAgent   Agent?   @relation(fields: [managerAgentId], references: [id], onDelete: SetNull)
}
```

### 消息来源标记

```prisma
model ChatMessage {
  // ...现有字段...
  source       String   @default("user")  /// "user" | "super" | "manager" | "sub"
}
```

### Agent 间消息通道（新增表）

```prisma
model AgentMessage {
  id          String   @id @default(cuid())
  fromAgentId String   /// 发送方 Agent id
  toAgentId   String   /// 接收方 Agent id
  sessionId   String?  /// 关联的 ChatSession（投递到哪个对话）
  content     String   /// 消息内容
  source      String   /// "super" | "manager" | "sub" | "user"
  status      String   @default("pending")  /// "pending" | "delivered" | "consumed"
  createdAt   DateTime @default(now())
  deliveredAt DateTime?
  // 关系
  fromAgent   Agent    @relation("AgentMsgFrom", fields: [fromAgentId], references: [id])
  toAgent     Agent    @relation("AgentMsgTo", fields: [toAgentId], references: [id])
}
```

---

## 4. 权限模型

### Agent CRUD 权限矩阵

| 操作 | 超级 Agent | 管理 Agent | 子 Agent | 用户 |
|---|---|---|---|---|
| 创建 Agent | ✅ 任何层级 | ✅ 仅本 Workspace 子 Agent | ❌ | ✅ |
| 编辑 Agent | ✅ 任何层级 | ✅ 仅本 Workspace 子 Agent | ❌ | ✅ |
| 删除 Agent | ✅ 任何层级 | ✅ 仅本 Workspace 子 Agent | ❌ | ✅ |
| 创建 Workspace | ✅ | ❌ | ❌ | ✅ |
| 编辑 Workspace | ✅ | ✅ 仅本 Workspace | ❌ | ✅ |

### 实现：Agent 工具封装

把 Agent CRUD 封装为 native tools，按 tier 权限控制：

```typescript
// 超级 Agent 专属工具
"agent_create"      // 创建任意层级 Agent
"agent_update"      // 编辑任意 Agent
"agent_delete"      // 删除任意 Agent
"workspace_create"  // 创建 Workspace（自动创建管理 Agent）
"workspace_list"    // 列出所有 Workspace
"agent_inspect"     // 获取任意 Agent 的完整上下文（越级查看）

// 管理 Agent 专属工具
"agent_create_sub"  // 仅创建本 Workspace 子 Agent
"agent_update_sub"  // 仅编辑本 Workspace 子 Agent
"agent_delete_sub"  // 仅删除本 Workspace 子 Agent

// 所有 Agent 可用
"agent_send_message"  // 向允许的层级发送消息（权限校验在工具内）
"agent_report_back"   // 向任务来源 Agent 回报结果（默认工具）
```

权限校验在工具执行层：`ctx.agentSnapshot.tier` 决定可调用哪些工具。

---

## 5. 心跳机制

### 设计

每个 Agent 可配置心跳：

```json
{
  "enabled": true,
  "cron": "0 */6 * * *",       // 每 6 小时
  "goal": "检查信息源更新并整理新文章",
  "lastRunAt": "2026-07-08T10:00:00Z",
  "lastRunStatus": "success"
}
```

### 执行流程

1. `HeartbeatEngine`（新模块）启动时加载所有 `heartbeat.enabled=true` 的 Agent
2. 按 cron 表达式注册定时任务（复用 `node-cron`）
3. 触发时：
   - 创建一条 `source="system"` 的消息到该 Agent 的默认 session
   - 消息内容为心跳 goal
   - 自动触发 `agentStream`（无需用户发起）
4. Agent 执行任务，结果进入 session 队列
5. 更新 `heartbeat.lastRunAt` + `lastRunStatus`

### 与现有 TriggerEngine 的关系

- `TriggerEngine`：文件变更/webhook 触发 → 执行动作
- `TaskScheduler`：cron 定时 → 执行 Task
- `HeartbeatEngine`：**cron 定时 → 触发 Agent 对话**（新增，复用 node-cron）

三者并存，HeartbeatEngine 专注 Agent 自主启动。

---

## 6. Agent 间消息系统

### SwarmBus 抽象层

```typescript
interface SwarmBus {
  // 派发任务
  dispatch(agentId: string, task: TaskInput): Promise<TaskHandle>;
  // 查询/取消/等待
  status(taskId: string): Promise<TaskStatus>;
  cancel(taskId: string): Promise<void>;
  await(taskId: string, timeoutMs?: number): Promise<TaskResult>;
  // Agent 间消息
  send(fromAgent: string, toAgent: string, message: AgentMessage): Promise<void>;
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): void;
  // 越级查看（超级 Agent 专用）
  inspect(agentId: string): Promise<AgentContext>;
}
```

### 两个实现

| 实现 | 后端 | 适用场景 |
|---|---|---|
| `LocalSwarmBus` | SQLite `AgentMessage` 表 + 进程内事件 | `SWARM_MODE=local`（默认，零依赖） |
| `RedisSwarmBus` | BullMQ Queue + Redis pub/sub | `SWARM_MODE=redis`（完整 swarm 能力） |

### 消息投递流程

```
超级 Agent 调用 agent_send_message({ toAgentId, content })
  → SwarmBus.send()
  → 写入 AgentMessage 表（status=pending）
  → 目标 Agent 的 session 队列收到消息（source="super"）
  → 前端轮询 pullAsyncDeliveries 拉到
  → consumeQueue 消费（asyncResultQueue 优先）
  → Agent 收到消息，生成回复
  → 回复通过 agent_report_back 工具发回超级 Agent
```

### 默认可见性

- 管理 Agent 的运行过程对超级 Agent **默认不可见**
- 超级 Agent 可用 `agent_inspect` 工具获取管理 Agent 的完整上下文
- 管理 Agent 有 `agent_report_back` 工具：决定是否将回复发送给任务来源 Agent

---

## 7. API Key 管理

### 设计

```prisma
model Agent {
  apiKey String?  /// 专属 key（不设则用 env 的 LLM_API_KEY）
}
```

### 免费 Key 列表工具

```typescript
"free_api_keys_list"  // 列出可用的免费 API Key（从 GitHub 项目同步）
"free_api_keys_fetch" // 获取一个可用 key（轮询分配）
```

- 启动时从 GitHub 项目（如 `api-key-hub`）下载 key 列表到 `content/api-keys.json`
- Agent 可查询/使用这些 key
- `sync` 脚本定时更新

---

## 8. 邮件通知

### 工具

```typescript
"send_email"  // 通过 AgentEmail 或 SMTP 发送邮件
```

- Agent 完成任务后可调用 `send_email` 通知用户
- 配置：`EMAIL_PROVIDER=agentemail|smtp`，`EMAIL_TO=user@example.com`
- 管理 Agent 和超级 Agent 默认有此工具

---

## 9. 技术选型

### 消息中间件

| 方案 | 选择 | 理由 |
|---|---|---|
| **BullMQ + Redis** | ✅ Phase 2 | Node.js 任务队列专用，Worker 进程隔离，优先级/重试/延迟内置，FlowProducer 支持任务依赖图 |
| SQLite AgentMessage 表 | ✅ Phase 1 | 零依赖，`SWARM_MODE=local` 默认实现 |
| RabbitMQ | ❌ | 企业 AMQP 路由，对 agent swarm 过重 |
| NATS | ❌ | 生态较小，过度 |

### 可选模式

```env
SWARM_MODE=local    # 默认：SQLite + 进程内（零依赖）
SWARM_MODE=redis    # 完整：BullMQ + Redis（需 Redis 进程）
```

### docker-compose

```yaml
services:
  redis:
    image: redis:7-alpine
    profiles: ["swarm"]  # 仅 SWARM_MODE=redis 时启动
```

### 其他技术

| 组件 | 技术 | 说明 |
|---|---|---|
| 心跳调度 | node-cron | 已有依赖，复用 TaskScheduler 模式 |
| 邮件 | AgentEmail / nodemailer | AgentEmail 优先，SMTP 兜底 |
| 进程隔离 | worker_threads（Phase 3） | BullMQ Worker 天然支持 |
| 可视化 | Bull Board（Phase 4） | BullMQ 自带 Dashboard |

---

## 10. 可行性分析

### 高可行性 ✅

| 模块 | 评估 | 说明 |
|---|---|---|
| 三层 Agent 层级 | ✅ 高 | Agent 表加 `tier`/`parentId`/`workspaceId` 字段，无架构改造 |
| 权限模型 | ✅ 高 | 工具执行层按 `tier` 校验，现有 `isToolAuthorized` 已有框架 |
| Agent 间消息 | ✅ 高 | 新增 `AgentMessage` 表 + `SwarmBus` 掽象，前端已有队列消费机制 |
| 心跳机制 | ✅ 高 | 复用 node-cron，HeartbeatEngine 模仿 TaskScheduler |
| Agent CRUD 工具化 | ✅ 高 | 把 tRPC `agent.create/update/delete` 封装为 native tools |
| API Key 管理 | ✅ 高 | Agent 表加 `apiKey` 字段 + 免费 key 同步脚本 |
| 邮件通知 | ✅ 高 | nodemailer / AgentEmail，单个 native tool |

### 中可行性 ⚠️

| 模块 | 评估 | 风险 |
|---|---|---|
| RedisSwarmBus (BullMQ) | ⚠️ 中 | 需引入 Redis 依赖；但做成可选模式，不影响默认 |
| 进程隔离 (worker_threads) | ⚠️ 中 | Agent 在独立线程跑，需解决 SQLite 跨线程访问（需 better-sqlite3 或主线程代理） |
| 超级 Agent 自主决策质量 | ⚠️ 中 | 依赖 LLM 能力，需好的 system prompt + 工具设计；心跳可能产生无效任务 |
| 免费 API Key 可靠性 | ⚠️ 中 | 免费 key 可能限速/失效，需轮询 + fallback 到 env key |

### 低风险 ❌（不建议现阶段做）

| 模块 | 评估 | 理由 |
|---|---|---|
| 多机部署 | ❌ | 本地优先项目，过度 |
| Agent 动态发现 | ❌ | 静态层级已满足，动态发现是更远期的 swarm 特性 |

---

## 11. 分阶段实施计划

### Phase 1：Agent 层级 + 权限 + CRUD 工具化（无新依赖）

**目标**：超级/管理/子 Agent 三层 + Agent CRUD 作为工具

- [ ] Agent 表加 `tier`/`workspaceId`/`parentId`/`apiKey`/`heartbeat` 字段
- [ ] Workspace 表加 `managerAgentId`
- [ ] `workspace_create` 工具：超级 Agent 创建 Workspace 时自动创建管理 Agent
- [ ] `agent_create`/`agent_update`/`agent_delete` 工具（按 tier 权限）
- [ ] ChatMessage 加 `source` 字段
- [ ] 前端 Agent 管理页显示层级 + Workspace 归属
- [ ] 测试 + 文档

**工作量**：3-4 天

### Phase 2：Agent 间消息系统 + SwarmBus

**目标**：Agent 间可互相发消息，消息进入 session 队列

- [ ] `AgentMessage` 表
- [ ] `SwarmBus` 接口 + `LocalSwarmBus`（SQLite 实现）
- [ ] `agent_send_message` / `agent_report_back` / `agent_inspect` 工具
- [ ] 消息投递到目标 Agent 的 session 队列（source 标注来源）
- [ ] 前端队列显示消息来源标签
- [ ] 权限校验：子 Agent 不能给超级 Agent 发消息
- [ ] 测试 + 文档

**工作量**：4-5 天

### Phase 3：心跳机制

**目标**：Agent 定时自主启动任务

- [ ] `HeartbeatEngine` 模块（复用 node-cron）
- [ ] Agent `heartbeat` 配置 UI（管理页）
- [ ] 心跳触发 → 自动创建 session 消息 → 触发 agentStream
- [ ] `heartbeat.lastRunAt`/`lastRunStatus` 记录
- [ ] 前端显示心跳状态 + 下次运行时间
- [ ] 测试 + 文档

**工作量**：3-4 天

### Phase 4：Redis SwarmBus（可选升级）

**目标**：完整 swarm 能力，进程隔离

- [ ] `RedisSwarmBus`（BullMQ Queue + Worker + pub/sub）
- [ ] `SWARM_MODE=local|redis` 切换
- [ ] docker-compose redis profile
- [ ] Worker 进程隔离（worker_threads）
- [ ] Bull Board 可视化
- [ ] 测试 + 文档

**工作量**：5-7 天

### Phase 5：邮件 + API Key + 免费 Key 同步

**目标**：任务完成邮件通知 + API Key 管理

- [ ] `send_email` 工具（AgentEmail / nodemailer）
- [ ] Agent `apiKey` 字段使用（优先于 env）
- [ ] 免费 key GitHub 项目同步脚本
- [ ] `free_api_keys_list` / `free_api_keys_fetch` 工具
- [ ] 测试 + 文档

**工作量**：2-3 天

---

## 12. 与现有实现的关系

| 现有 | 在新架构中的角色 |
|---|---|
| `asyncJobOrchestrator` | `LocalSwarmBus` 的任务调度基础 |
| `asyncJobManager` | `LocalSwarmBus` 的任务管理（spawn/status/cancel） |
| `run_async`/`spawn_subagent` | 保留，底层切换到 SwarmBus |
| `task_status`/`await_async`/`cancel_async` | 保留，底层切换到 SwarmBus |
| `userQueue` + `asyncResultQueue` | 保留，新增 `agentMessageQueue`（Agent 间消息） |
| `TaskScheduler` | 保留，与 HeartbeatEngine 并存 |
| `TriggerEngine` | 保留，与 HeartbeatEngine 并存 |
| `subagent ChatSession` | 保留，作为子 Agent 任务的 UI 载体 |
| `Credential` 表 | 保留，Agent `apiKey` 可引用 Credential 或直接存 |

---

## 13. 待确认的设计决策

1. **超级 Agent 是预置的还是用户创建的？**
   - 建议：首次启动时自动创建一个默认超级 Agent（类似 root 账户），用户可配置其 system prompt

2. **管理 Agent 的默认 session 是哪个？**
   - 建议：每个管理 Agent 有一个"主 session"用于接收超级 Agent 命令和心跳消息；用户对话可另开 session

3. **子 Agent 给超级 Agent 发消息被禁止，但管理 Agent 可以转发吗？**
   - 建议：可以。管理 Agent 有 `agent_forward_message` 工具，可替子 Agent 向上级转发

4. **心跳任务失败后的重试策略？**
   - 建议：心跳 goal 执行失败 → 记录 `lastRunStatus=failed` → 下一个 cron 周期重试 → 连续 3 次失败 → 邮件通知用户

5. **Workspace 的 FileBus 思想具体形态？**
   - 建议：每个 Workspace 的 `path` 目录下有 `.knowpilot/` 子目录，存 `log.jsonl`（操作日志）+ `state.json`（共享状态）+ `tasks/`（任务文件）

---

> 最后更新：2026-07-08。设计阶段，等待用户确认后开始 Phase 1 实施。
