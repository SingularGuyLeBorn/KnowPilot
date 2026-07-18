# KnowPilot 未来功能规划

> 本文档描述已规划但尚未实现的功能。每条功能都给出动机、期望行为和实现提示。

---

## 1. Agent 自动开启新 Session

### 1.1 动机

当一个会话的交互轮数太多时：

- 上下文越来越长，LLM 调用成本升高。
- 历史消息里混杂了多个话题，Agent 容易答非所问。
- 用户想“换个干净会话继续”，但又不想丢失之前的结论。

### 1.2 期望行为

1. Agent 在 ReAct 循环中判断：当前 session 的轮数或 token 超过阈值。
2. Agent 调用一个工具（暂定名 `session_rotate` 或 `session_fork`）：
   - 让 Agent 自己生成一份总结文档（Markdown）。
   - 把总结文档写入 `content/sessions/[old-session-id]-summary.md`（或 Memory）。
   - 结束当前 session（标记为 `archived` 或 `rotated`）。
   - 启动**同一个 Agent** 的新 session。
   - 新 session 的第一条 user 消息设为总结内容。
3. 如果用户当前正在查看旧 session 页面：
   - **不要自动切换**到新 session。
   - 只在当前页面显示一条提示：「新 session 已创建：xxx」。
   - 用户手动点击提示跳转到新 session。

### 1.3 工具设计草案

```ts
session_rotate({
  summary: string;          // Agent 自己写的总结
  reason?: string;          // 为什么 rotate（轮数过多 / 话题切换 / 用户要求）
  carryMemoryIds?: string[]; // 需要带到新 session 的 Memory
})
```

工具返回：

```ts
{
  success: true,
  oldSessionId: string,
  newSessionId: string,
  summaryPath: string,
}
```

### 1.4 前端呈现

- 旧 session 页面顶部出现 toast：「新 session 已创建：[新会话标题]，点击跳转」。
- 左栏会话列表新增一条新会话。
- 旧会话标记为已归档，不再接收新消息。

### 1.5 待确认问题

- 总结文档存在哪里：`content/sessions/` 还是 Memory？
- 旧 session 是 `archived` 还是 `deleted`？
- 用户是否可以在 `/settings` 里配置自动 rotate 的阈值？

---

## 2. 自动压缩（Auto-Compact）

### 2.1 动机

长会话的 token 成本会持续升高，即使不 rotate，也需要把历史上下文压缩成更短的形式。

### 2.2 期望行为

1. 当 session 的累计 token 超过阈值（例如 80% 模型上下文）。
2. 系统自动触发压缩：
   - 调用 LLM 把历史消息压缩成一份“会话摘要”。
   - 摘要写入 Memory（`kind="summary"`）或 `ChatSession.summary` 字段。
3. 后续 LLM 调用只携带：
   - 压缩后的摘要。
   - 最近 N 条原始消息（滑动窗口）。

### 2.3 实现提示

- 复用现有 `autoCompact` 相关代码（如果有的话）。
- 压缩结果需要可追溯：用户能在 `/memories` 或 session 详情页看到摘要。
- 压缩失败时降级：只裁剪最早的消息，不压缩。

### 2.4 待确认问题

- 压缩阈值是按 token 还是按消息条数？
- 摘要存在 Memory 还是 `ChatSession` 上？
- 用户是否可以手动触发压缩？

---

## 3. 推送替代轮询

### 3.1 动机

当前多个列表/队列依赖前端轮询：

- `pullAsyncQueue`
- `pullAgentMessages`
- `session.listRunning`
- `session.listChildren`
- 异步任务运行状态

轮询的缺点：

- 延迟：要等下一个轮询周期才更新。
- 浪费：没有变化时也一直在请求。

### 3.2 期望行为

- 父会话/子会话有活跃 SSE 流时，后端直接推送事件：
  - `async_delivery`：异步任务完成。
  - `agent_message`：上级 Agent 发来消息。
  - `session_status`：会话状态变化。
- 无活跃流时，fallback 到拉取/补推。
- 每条事件带自增 ID，重连时前端上报 `lastEventId`，后端补推缺失事件。

### 3.3 待确认问题

- 是否所有轮询都改成推送，还是只改 `pullAsyncQueue` 和 `pullAgentMessages`？
- 推送通道是用现有 SSE 还是新增 WebSocket？

---

## 4. 队列持久化与拖拽排序

### 4.1 动机

用户希望发送队列：

- 能拖拽调整顺序。
- 刷新和重启后顺序不丢失。

### 4.2 期望行为

- 新建 `SessionQueueItem` 表，存储用户和上级 Agent 的队列项。
- 每条队列项带 `order` 字段。
- 拖拽后 500ms 防抖写 DB。
- 异步任务结果支持 `pinned`，pinned 的项排在最后。

### 4.3 待确认问题

- 是否复用 `ChatMessage` 表加 `status=queued`，还是新建表？
- 上级 Agent 消息是否允许用户编辑内容（建议只允许调整顺序，不允许编辑）？

---

## 5. 多实例部署

> **决策（2026-07-18）**：**缓做完整多实例**。单用户本地默认 `SWARM_MODE=local` 足够。  
> 已落地底座（`SWARM_MODE=redis` 时生效，local 无感）：分布式 prepare 锁、`RedisSwarmBus` 与 Local 语义对齐、session running Redis 宣称。  
> **暂不做**：全局任务池 Redis 化、BullMQ Worker 消费 Agent、PostgreSQL 迁移、SSE 跨实例亲和。真要多机部署时再开，且几乎必须切 Postgres。

### 5.1 动机

进程内 `agentRunLocks` / hub / 任务池在多实例下失效。

### 5.2 完整形态（未来，非当前目标）

- Agent 运行锁、异步任务池、消息总线、busy 信号全走 Redis。
- 多写 DB → PostgreSQL；SSE sticky 或跨实例事件回放。

---

## 6. Agent 进化（Hermes 风格）

> **决策（2026-07-18）**：**收窄**。保留「Run 后写 experience Memory」（已有）；**不做**默认全自动提炼 Skill / 心跳审查 / 无审批上线。  
> 原因：生成物多为伪代码、discover 缺真实使用统计、单用户更需要可查经验而非自动造 Skill。  
> 若以后要做：只产 `enabled=false` draft + 人工审批，再谈 promote。

### 6.1 已有

- `accumulateExperience`（stream onDone）→ `Memory.type=experience`；防注入白名单已排除。
- 工具半成品：`generate_skill_from_experience` / `skill_discover` / `skill_promote`（**未进默认 tools**）。

### 6.2 明确不做（当前阶段）

- 管理 Agent 心跳自动审查 experience → Skill。
- 超级 Agent 跨 Workspace 自动推广 Skill。
- 无统计的 `skill_discover`「假繁荣」。

---

## 7. 其他候选

- **多模态识图**：图片附件直接走 vision 模型，不依赖 OCR。
- **协作模式**：多个用户共享同一个 Workspace（与单用户定位冲突，低优先）。
- **插件市场**：用户可以发布/安装 Skill 和 MCP Server。
- ~~**移动端适配**~~：**已落地**（底栏/Chat 单栏叠层/`pnpm remote`/Settings 清单）。

---

## 8. 综述对照后续项（2026-07-18 登记）

> 对照 `docs/surveys-2026/` 两篇对比文 + **当前代码**。

### 8.1 综述文已过时（不必再排）

- `memory_update`（native + MemoryRepository 软版本链）
- `todo_write` / `todo_read`（会话级 todoState）
- `AGENT_MAX_TOOL_CALLS_PER_RUN` 循环强制（reactLoop）

### 8.2 进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P1 | 记忆检索：BM25 × (1+strength) × recency；retrieve-or-not 门控 | **已落地** |
| P1 | 记忆 attribution / validTo + 心跳 consolidate | **已落地** |
| P1 | Run/Session 轨迹 JSONL 导出骨架 | **已落地**；Mock 平台基准仍待 |
| P2 | 轻量 SOP / 阶段工件（Markdown 接力） | 待做 |
| P2 | 常驻层 USER.md/AGENT.md 硬预算 | **已落地** |
| P3 | **MCP 远程（Streamable HTTP）** | **已落地**（`transport=http` + url/headers；stdio 默认并存） |
| P3 | 本地 side 模型（如 Ollama） | 按需，与 MCP 正交 |
| — | A2A（跨产品 Agent 协议） | **不做**（见下） |

### 8.3 理念不做

- 对等群聊 Swarm、参数化记忆、容器级沙箱（单用户本地定位）。
- **A2A 联邦 / Agent Card 市场**：已有私有 SwarmBus；无外部对端不造标准协议层。
