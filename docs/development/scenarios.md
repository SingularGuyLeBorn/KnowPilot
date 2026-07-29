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

## 场景 9～N：产品能力已落地、文档补登（简表）

下列场景在代码/E2E 已存在，但原先未写入本文件；与场景 1～8 同属「已设计」。

| # | 场景 | 用户目标 | 关键能力 |
|---|------|----------|----------|
| 9 | 流式中连续发送 / 队列 | 边等回复边排队下一条 | `userQueue` + drain（见 `chat-scenario-states.md` §4） |
| 10 | 刷新 / 切会话后续传 | 不丢流式结果 | StreamHub + INV-5/7；E2E `chat-resume-mock` |
| 11 | 阅读 LiveDoc + 划词解释 | 读文时选中一段即时解释 | `explainSelection`；不写回文章 |
| 12 | 编辑器选区 AI 改写 | 润色 / 精简 / 扩写选区 | Canvas 式 toolbar + `editorAgentComplete` |
| 13 | 相关笔记推荐 | 读完一文发现邻近笔记 | `post.related`（FTS+标签+花园） |
| 14 | Chat → 知识库落库 | 助手结论一键成文 | `post.createFromChat`（新建/覆盖/追加） |
| 15 | 中栏派工条 | 一眼看子任务进度 | `ChatDispatchStrip` + 运行栏 |
| 16 | 本地模型对话 | 无云 Key 也能聊 | Ollama 等；模型 id `ollama/…` |
| 17 | Inbox 抓取 → 蒸馏成文 | 收藏/链接进花园 | inbox capture + distill |
| 18 | 视频转文字 | B 站/YouTube → 逐字稿 | `video_transcript` |
| 19 | 平台登录后读文 | 知乎等需登录内容 | `platform_login` + `read_article` |
| 20 | 深度调研 Goal | 多轮外环直到达标 | session goal / deep research |

状态机级细节（phase / MessageStore / Compose）见 [`chat-scenario-states.md`](./chat-scenario-states.md)。

---

## 场景 A：晨间简报 → 花园笔记（实用新增）

> **价值**：把「快」（Agent 扫源）和「慢」（你筛进花园）接成闭环；本地模型可先做摘要，云模型做精炼。

### 用户动作

1. 前一晚在 Inbox / InfoSource 配好关注源（RSS、知乎收藏、固定 URL 列表）。
2. 早上打开 Chat，对超级 Agent 或专用「简报员」说：「把昨夜新增条目汇总成 5 条要点，挑 1～2 条值得沉淀的写成 knowledge 花园草稿。」
3. 看完简报后，在助手气泡点「写入知识库」→ 追加到既有「每日简报」文，或新建一篇。

### 系统行为

1. Agent 调 `inbox` / `infoSource` / `read_article`（必要时 `platform_login`）拉增量。
2. 可选：先用 `ollama/…` 做粗摘要（省云额度），再用云模型精炼标题与标签。
3. 用户确认后 `post.createFromChat`（mode=`append` 或 `create`，garden=`knowledge`）。
4. 若需后台扫源：前一夜 `async_task_run` / 非阻塞子 Agent，晨间只消费投递结果（中栏派工条可见）。

### 前端呈现

1. Chat：要点列表 +「建议落库」条目。
2. 派工条：昨夜任务 done / 待消费。
3. 落库对话框：花园 knowledge、标签 `日报`、可选追加到「每日简报」文。
4. 打开新笔记底部出现「相关笔记」（连到昨日简报 / 主题旧文）。

### 验收一句

「从 Inbox 增量到 knowledge 草稿 ≤ 3 分钟，且正文只来自服务端 messageId。」

---

## 场景 B：专题深挖 → 阻塞调研子 Agent → 一键成文（实用新增）

> **价值**：一次对话内完成「调研—整合—落库」，适合写技术专栏 / 学习笔记，而不是散落在 Chat 历史里。

### 用户动作

1. 在 Chat 说：「调研 DDPM 采样技巧，对比 3 篇我花园里已有的 diffusion 笔记，写一篇可发布草稿。」
2. 等父 Agent 整合完成后，点「写入知识库」→ 新建到 `diffusion`（或 knowledge）花园，填分类/标签后发布。

### 系统行为

1. 父 Agent：`post_list` / `post.related` 思路的检索（`post_list` + 读正文）摸清已有笔记。
2. `spawn_subagent(waitForResult=true)` 派「资料员」跑 `web_search` + `read_article` / `save_webpage`。
3. 阻塞返回后父 Agent 对照旧笔记写「增量」而非重复科普。
4. 用户 `createFromChat` → Markdown 落盘；相关笔记推荐挂到旧 diffusion 文。

### 前端呈现

1. 时间线：`spawn_subagent` running→done；派工条可跳转子会话看过程。
2. 最终回复带结构（摘要 / 对比表 / 待验证点）。
3. 落库成功链到 `/posts/...`；阅读页底部相关笔记指向旧文。

### 验收一句

「子 Agent 阻塞调研完成后，父回复可直接成文，且与花园旧文有可点击相关推荐。」

---

## 场景 C：本地草稿 + 云精修 + 选区打磨（实用新增）

> **价值**：敏感/未定稿内容尽量不出域；定稿前再用云模型与编辑器选区改写，兼顾隐私与质量。

### 用户动作

1. `.env` 设 `DEFAULT_LLM_MODEL=ollama/<本地模型>`（或 Chat 菜单选本地模型）。
2. 口述或粘贴一坨乱笔记：「整理成结构清晰的学习笔记，先别发网上。」
3. 本地模型出草稿后，切换到云模型：「只改第 2 节，更短、更可引用。」
4. 进入编辑器 / LiveDoc，对某段用选区工具「精简」或「扩写」。
5. 满意后发布；附件已在 `uploads/{garden}/{postId}/`，改标题 slug 也不掉图。

### 系统行为

1. 会话 model=`ollama/...` → 本地 OpenAI 兼容调用，无云 Key 也可跑。
2. 用户改 model 后下一轮走云厂商；历史仍在同一 Session。
3. 选区改写走 `editorAgentComplete`，Accept 才写回正文。
4. 图片上传带 `postId`（或新建页 `draftKey`），与 slug 解耦。

### 前端呈现

1. 模型菜单显示 `llama3.2 · ollama` 等本地标签。
2. 本地不可达时有可读错误（未连接），不静默失败。
3. 编辑器选区浮条：润色 / 精简 / 扩写 / 自定义。
4. 发布后阅读页相关笔记 + 稳定图片 URL。

### 验收一句

「本地出稿 → 云改一节 → 选区精简，全程同一篇文章，改 slug 后图片仍在。」

---

## 总结

- **普通对话**：用户消息 → userQueue → runStream → 左侧 assistant 气泡。
- **工具调用**：用户消息 → Agent 调工具 → 时间线展示工具卡片 → 最终回复。
- **阻塞式子 Agent**：父 Agent 等待 → 结果作为工具调用结果 → 父 Agent 继续 → 左栏 Async 面板留记录。
- **非阻塞式子 Agent**：父 Agent 立即返回 → 子 Agent 后台跑 → `agent_report_back` 投递 → 父会话右侧 user 气泡 → 父 Agent 继续。
- **异步任务**：同非阻塞子 Agent 共用投递机制，来源标识为 `Sync`。
- **审批**：高风险操作被拦截 → 用户批准 → 重新执行。
- **实用闭环（新增 A/B/C）**：晨间简报落库、专题阻塞调研成文、本地草稿+云精修+选区打磨。
