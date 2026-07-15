# KnowPilot 使用场景详解

> 本文档按“用户动作 → 系统行为 → 前端呈现”三段式描述最常见的使用场景。重点覆盖 Agent、子 Agent、异步任务（阻塞/非阻塞）。

---

## 场景 1：用户与主 Agent 普通对话

### 用户动作

1. 打开浏览器，进入 `http://localhost:3000/chat`。
2. 左栏选中某个 Agent 的主会话（例如“assistant 主会话”）。
3. 在底部输入框输入：“帮我总结今天的新闻。”
4. 点击右下角发送按钮（或按 Enter）。

### 系统行为

1. 前端创建一个 `ChatQueueItem`（kind=`user`），进入当前 session 的 `userQueue`。
2. `consumeQueue` 发现没有未消费的异步任务，消费这条用户消息：
   - 从 `userQueue` 移除。
   - 在对话区生成一个右侧 user 气泡（乐观占位）。
   - 调用 `streamAgentChat` 发起 SSE 流式请求。
3. 后端 `chatAgentStream`：
   - 创建/复用 `ChatSession`。
   - 把用户消息写入 `ChatMessage`（`role=user`，`source=user`）。
   - 组装历史消息 + system prompt，调用 LLM。
4. LLM 开始流式返回内容。

### 前端呈现

1. 右侧出现 user 气泡：“帮我总结今天的新闻。”
2. 左侧出现“思考中…”的流式 assistant 气泡。
3. 底部输入框上方可能出现 ThinkingTimeline，展示 thinking 步骤。
4. 流式结束后，左侧 assistant 气泡定格为最终回复。

---

## 场景 2：Agent 调用普通工具（以 `web_search` 为例）

### 用户动作

1. 在 Chat 输入：“搜索 React 19 的新特性。”
2. 发送。

### 系统行为

1. 同场景 1，用户消息进入 SSE 流。
2. LLM 判断需要调用 `web_search` 工具。
3. 后端通过 `runAgentLoopStream` 执行工具：
   - 发出 `tool_start` 事件。
   - 调用 `web_search` 原生工具。
   - 发出 `tool_end` 事件，附带搜索结果。
4. LLM 基于搜索结果继续生成最终回复。

### 前端呈现

1. 右侧 user 气泡：“搜索 React 19 的新特性。”
2. 时间线出现 `web_search` 工具卡片（running → done）。
3. 左侧 assistant 气泡最终回复：“React 19 的新特性包括 …”。

---

## 场景 3：阻塞式子 Agent（`spawn_subagent(waitForResult=true)`）

### 用户动作

1. 在 Chat 输入：“派个子 Agent 调研 React 19，我要你基于它的结果继续回答。”
2. 发送。

### 系统行为

1. 父 Agent 收到任务，进入 ReAct 循环。
2. LLM 调用 `spawn_subagent` 工具，参数：`waitForResult=true`，`task="调研 React 19 新特性"`，可指定 `name="React 调研员"`。
3. 后端：
   - 创建子 Agent（或复用指定 Agent）。
   - 把任务写入子 Agent 的 `AgentMessage` 收件箱。
   - **同步触发**子 Agent 运行（`triggerAgentRun`），阻塞等待子 Agent 完成。
4. 子 Agent 在后台（或同进程）运行：
   - 可能继续调用工具（`web_search`、`read_article` 等）。
   - 完成后返回最终回复字符串。
5. 父 Agent 拿到子 Agent 的返回内容，作为本次 `spawn_subagent` 工具调用的结果。
6. 父 Agent 继续生成最终回复，整合子 Agent 的调研结果。

### 前端呈现

1. 父会话右侧 user 气泡：“派个子 Agent 调研 React 19 …”。
2. 父会话时间线出现 `spawn_subagent` 工具卡片（running → done），结果内容可能显示“子 Agent 已完成：React 19 的新特性 …”。
3. 左侧 assistant 气泡是父 Agent 基于子 Agent 结果生成的最终回复。
4. **左栏 Async 面板**新增一条 `SubAgent` 运行记录，标识为子 Agent 调用。
5. 子 Agent 会话不会被自动打开；用户可在左栏“子 Agent”标签页手动打开查看完整过程。

### 关键点

- 阻塞式结果**不进入异步任务结果队列**。
- 阻塞式结果直接作为工具调用结果返回给父 Agent LLM。
- 父 Agent 在同一轮 ReAct 内即可看到结果并继续。

---

## 场景 4：非阻塞式子 Agent（`spawn_subagent(waitForResult=false)`）

### 用户动作

1. 在 Chat 输入：“派个子 Agent 去调研 React 19，跑完了告诉我。”
2. 发送。

### 系统行为

1. 父 Agent 收到任务，进入 ReAct 循环。
2. LLM 调用 `spawn_subagent` 工具，参数：`waitForResult=false`，`task="调研 React 19 新特性"`。
3. 后端：
   - 创建子 Agent（或复用指定 Agent）。
   - 把任务写入子 Agent 的 `AgentMessage` 收件箱。
   - 工具立即返回“已派生/已排队”，**不等待**子 Agent 完成。
4. 父 Agent 本轮可能继续生成一段说明，例如“已派生子 Agent，结果会投递回来。”
5. 子 Agent 后台运行：
   - 消费 `AgentMessage` 里的任务。
   - 调用必要工具。
   - 运行完成后调用 `agent_report_back`，把结果投递到**父 Agent 会话的异步任务结果队列**。
6. 父 Agent 会话收到异步结果：
   - 后端生成一条异步 delivery 记录，绑定到父 Agent 的当前 `sessionId`。
   - 前端通过推优先/拉兜底机制拿到 delivery，进入 `asyncResultQueue`。
   - `consumeQueue` 优先消费它，作为右侧 user 气泡喂给父 Agent。
7. 父 Agent 基于子 Agent 结果继续生成最终回复。

### 前端呈现

1. 父会话右侧 user 气泡：“派个子 Agent 去调研 React 19 …”。
2. 父会话时间线出现 `spawn_subagent` 工具卡片（done），结果内容为“子 Agent 已派生，结果会投递回来。”
3. 左侧 assistant 气泡：“已派生子 Agent，结果会投递回来。”
4. 左栏 Async 面板新增一条 `SubAgent 运行中` 记录。
5. 子 Agent 运行完成后：
   - 右栏 Runtime 出现一条新投递（SubAgent 标签 + 子 Agent 名字/任务名）。
   - 父会话右侧出现一条 user 气泡，内容是子 Agent 的调研结果，气泡来源标识为 `SubAgent · React 调研员`。
   - 父 Agent 继续生成左侧 assistant 气泡，总结最终结果。
6. 用户可点击右侧 user 气泡旁的“打开子 Agent 对话”或在左栏“子 Agent”标签页查看完整过程。

### 关键点

- 非阻塞式结果**进入**父会话异步任务结果队列。
- 子 Agent 必须显式调用 `agent_report_back` 才能回报。
- 异步结果优先级最高，会抢在用户后续消息之前被消费。

---

## 场景 5：异步任务（`async_task_run`，以 shell 脚本为例）

### 用户动作

1. 在 Chat 输入：“帮我跑一个脚本统计 `content/posts` 下有多少篇文章。”
2. 发送。

### 系统行为

1. 父 Agent 收到任务，判断需要后台运行。
2. LLM 调用 `async_task_run` 工具（专职非 LLM 纯工具任务；带 LLM 的子任务走 `spawn_subagent`），参数类似：`task="统计文章数"` + `toolCall={ tool: "run_shell", args: { command: "ls content/posts | wc -l" } }`。
3. 后端创建异步 job，返回 `jobId`。
4. 父 Agent 本轮说明“已启动后台任务，完成后通知你。”
5. 后台 job 完成后：
   - 生成异步 delivery 记录。
   - 前端拿到 delivery，进入 `asyncResultQueue`。
   - `consumeQueue` 消费它，作为右侧 user 气泡喂给父 Agent。
6. 父 Agent 总结任务结果。

### 前端呈现

1. 右栏 Runtime 出现一条 running/queued 任务。
2. 完成后右栏出现 done 投递。
3. 父会话右侧出现 user 气泡，内容是任务输出，来源标识为 `Sync · shell`。
4. 左侧 assistant 气泡总结任务结果。

### 关键点

- 异步任务和子 Agent 非阻塞共用同一套投递机制。
- 运行中的任务只出现在左栏 Async 面板，完成后才进右栏 Runtime 队列。

---

## 场景 6：审批（`Approval`）

### 用户动作

1. 用户让 Agent 执行一个高风险操作（如 `git_push`、`agent.delete`）。
2. Agent 在工具执行前触发审批。

### 系统行为

1. 工具执行前调用 `assertApprovalOrProceed`。
2. 如果没有有效 `approvalId`，后端创建一个 `Approval` 记录（`status=pending`）。
3. 工具调用被拦截，返回“需要审批”。
4. 用户进入 `/approvals` 页面。
5. 用户点击“批准并执行”。
6. 后端用 `approvalId` 重新执行原工具。

### 前端呈现

1. Chat 时间线显示工具卡片 `blocked: 需要审批`。
2. `/approvals` 页面出现一条 pending 审批。
3. 用户批准后，工具执行成功，Chat 时间线更新为 done。

---

## 场景 7：定时任务 / 心跳（Task + Trigger）

### 用户动作

1. 在 `/tasks` 页面创建一条 Task（如每天 9 点同步 RSS）。
2. 在 `/triggers` 页面把它绑定到一个 cron。

### 系统行为

1. Trigger 按 cron 触发 Task 运行。
2. Task 运行结果写入 `Run` 记录和日志。
3. 如果是 Agent 心跳，超级 Agent 按 `heartbeat` 配置自主运行。

### 前端呈现

1. `/runs` 页面出现新的运行记录。
2. `/logs` 页面出现相关日志。
3. 心跳触发的运行记录在 `Run.input.trigger` 里标记为 `heartbeat`。

---

## 场景 8：写文章（Post）

### 用户动作

1. 进入 `/editor`。
2. 输入标题、正文、标签。
3. 保存。

### 系统行为

1. 前端调用 `post.create` 或 `post.update`。
2. 后端写入 SQLite，同时把内容写回 `content/posts/{slug}.md`。
3. 自动保存：500ms 节流写 localStorage，2s 防抖调 `post.update`。

### 前端呈现

1. 编辑器显示 Markdown 实时预览。
2. 保存后 `/posts` 列表出现新文章。
3. 进入 `/posts/[slug]` 可查看渲染后的文章。

---

## 总结

- **普通对话**：用户消息 → userQueue → runStream → 左侧 assistant 气泡。
- **工具调用**：用户消息 → Agent 调工具 → 时间线展示工具卡片 → 最终回复。
- **阻塞式子 Agent**：父 Agent 等待 → 结果作为工具调用结果 → 父 Agent 继续 → 左栏 Async 面板留记录。
- **非阻塞式子 Agent**：父 Agent 立即返回 → 子 Agent 后台跑 → `agent_report_back` 投递 → 父会话右侧 user 气泡 → 父 Agent 继续。
- **异步任务**：同非阻塞子 Agent 共用投递机制，来源标识为 `Sync`。
- **审批**：高风险操作被拦截 → 用户批准 → 重新执行。
