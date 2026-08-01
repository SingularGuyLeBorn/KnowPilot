# 见微（OasisMind）使用场景详解

> 写法约定：每个场景都写清**理想状态下**「用户发什么 → Agent 怎么动作 → 系统/前端长什么样」。  
> 技术细节（phase / MessageStore）见 [`chat-scenario-states.md`](./chat-scenario-states.md)。  
> 灵感外链单独标注来源，不替代本产品契约。

---

## 场景 1：用户与主 Agent 普通对话

### 理想用户发言

> 帮我用三句话说明：见微本地优先是什么意思？不要搜网。

### Agent 理想动作

1. **不调工具**（用户已说不要搜网；问题可凭 system prompt + 身份回答）。
2. 直接流式输出三句以内的答复，语气像园丁助手，不堆术语。
3. 结束时不主动落库、不派子 Agent。

### 系统行为

1. 用户消息入 `userQueue` → `consumeQueue` → `streamAgentChat` SSE。
2. 落库 `ChatMessage(role=user, source=user)`；LLM 流式返回。
3. 无 `tool_start`。

### 前端呈现

1. 右：用户气泡；左：流式 assistant → 定格。
2. 时间线可有 Thinking，无工具卡。

### 关键工具

无。

### 验收

纯对话一轮内结束；无工具卡、无派工条跳动。

---

## 场景 2：Agent 调用普通工具（`web_search`）

### 理想用户发言

> 搜索 React 19 正式版相对 18 的 5 个关键变化，列出处链接，中文简述。

### Agent 理想动作

1. 调 `web_search`（关键词如 `React 19 release notes` / `React 19 what's new`），必要时换关键词再搜 1～2 次（勘察白名单，换参不熔断）。
2. 对最可信的 1～2 条结果用 `read_article` 核对（长文 `offset` 翻页）。
3. 汇总成「5 点 + 链接」回复；不确定处标明「待核实」。
4. **不**为搜几条新闻就 `spawn_subagent`。

### 系统行为

SSE → ReAct → `tool_start`/`tool_end`（web_search / 可选 read_article）→ 最终回复。

### 前端呈现

时间线：`web_search`（及可选 `read_article`）running→done → 结构化列表回复。

### 关键工具

`web_search`、`read_article`（可选）。

### 验收

有出处链接；工具卡可见；同参连打 ≥3 次会被熔断（正常）。

---

## 场景 3：阻塞式子 Agent（`spawn_subagent(waitForResult=true)`）

### 理想用户发言

> 派一个「资料员」调研 React 19 Server Components 的适用边界，读完官方文档要点后把结论给我；我要你基于它的结果再给迁移建议。这次同步等它跑完。

### Agent 理想动作（父）

1. 简短确认任务边界后调 `spawn_subagent`：`waitForResult=true`，`name` 如「React 资料员」，`task` 写清：搜官方文档 → 读 2～3 篇 → 输出「适用/不适用/坑」三条。
2. **阻塞等待**工具返回（本轮不先胡编结论）。
3. 拿到子结果后写「迁移建议」段，明确哪些来自子 Agent、哪些是父整合。
4. 不问用户「要不要打开子会话」；需要时可提示左栏可看过程。

### Agent 理想动作（子）

`web_search` → `read_article` / `save_webpage` → 汇总 →（阻塞路径下结果经工具返回，不必 `agent_report_back`）。

### 系统行为

父 ReAct 内同步等子跑完；结果作工具返回值；**不进**异步投递队列。

### 前端呈现

1. `spawn_subagent` 卡长时间 running→done。
2. 派工条可跳转子会话。
3. 父最终气泡含调研 + 迁移建议。

### 关键工具

父：`spawn_subagent`；子：`web_search`、`read_article`、`save_webpage`。

### 验收

父在同一轮拿到完整子结论再答；异步结果队列无该次 delivery。

---

## 场景 4：非阻塞式子 Agent（`waitForResult=false`）

### 理想用户发言

> 派个子 Agent 去调研 React 19，跑完了告诉我；你先别干等，先用一句话告诉我你派了谁。

### Agent 理想动作（父）

1. `spawn_subagent(waitForResult=false, …)`，立刻向用户说明「已派某某，结果会回来」。
2. 本轮结束；**不要**轮询 `async_task_status` 刷屏。
3. 子完成后经 `agent_report_back` 投递进父会话 → 父被喂一条「子结果」气泡 → 再总结。

### Agent 理想动作（子）

调研 → **必须** `agent_report_back`（非阻塞唯一交付通道）。

### 系统行为

工具立即返回「已派生」；完成后 delivery → `asyncResultQueue` 优先消费。

### 前端呈现

1. 先：短回复「已派工」。
2. 派工条 running → 右栏投递 → 右侧出现 SubAgent 来源气泡 → 父再答一版总结。

### 关键工具

`spawn_subagent`、`agent_report_back`（子）。

### 验收

用户无需 F5；开着的父会话会自己出现结果气泡并续答。

---

## 场景 5：异步纯工具任务（`async_task_run`）

### 理想用户发言

> 后台帮我统计 `content/posts` 下有多少篇 `.md`（不含 `.trash`），跑完告诉我数字就行。

### Agent 理想动作

1. 判断：**无 LLM 子任务** → `async_task_run` + `toolCall={ tool: "run_shell", args: { command: "…" } }`（或等价安全命令），不要 `spawn_subagent`。
2. 立刻回复「已入队，jobId=…，完成后会投递」。
3. 结果投递后用一句话报数字；不复述整段 shell 日志除非用户要。

### 系统行为

入全局任务池 → 完成 delivery → 父会话消费。

### 前端呈现

右栏 Runtime：queued/running → done；父侧 Sync 来源气泡 → 短总结。

### 关键工具

`async_task_run`、`run_shell`（经 task）。

### 验收

与非阻塞子 Agent 共用投递管道；来源标识为 Sync/工具而非 SubAgent。

---

## 场景 6：审批（高风险操作）

### 理想用户发言

> 把当前仓库改动 `git commit` 并尝试 `git_push` 到 origin（若需审批就走审批）。

### Agent 理想动作

1. 先说明将执行的破坏性/外发操作。
2. 调 `git_commit` / `git_push`；若门禁拦截 → **停住**，告诉用户去 `/approvals` 批准，不要假装已推送。
3. 用户批准后由系统带 `approvalId` 续跑或用户再说「继续」；Agent 根据工具结果如实汇报。

### 系统行为

`assertApprovalOrProceed` → pending Approval → 批准后执行；SSE/`approval_updated` 推管理页。

### 前端呈现

工具卡 blocked；`/approvals` pending；批准后卡变 done。

### 关键工具

`git_commit`、`git_push`（及同类 destructive）。

### 验收

未批准绝不静默成功；开着的 `/approvals` 秒级出现条目。

---

## 场景 7：定时任务 / 心跳

### 理想用户发言（配置侧）

> （在 `/tasks`）每天 8:00 让超级 Agent 扫 Inbox 增量并写一条「待我审阅」备忘。  
> （Chat 侧可选）「看下心跳最近是不是 quiet / 被熔断了。」

### Agent 理想动作（Chat 查询时）

1. 用只读检查（如 `agent_inspect` / 管理页语义）说明 lastMode、是否 suspended，**不**伪造「刚跑完」的简报。
2. 若用户要「现在就跑一轮」：走显式触发路径，不假装 cron 已改。

### 系统行为

Trigger/cron → Task/心跳决策层 → Run；僵尸重启标 failed/paused，不自动续跑。

### 前端呈现

`/runs`、`/logs` 有记录；心跳在 Run.input.trigger 可辨。

### 关键能力

Task、Trigger、HeartbeatEngine、`agent_inspect`。

### 验收

到点自跑；用户开着管理页能看到状态变化（推+短拉）。

---

## 场景 8：写文章（编辑器 Post）

### 理想用户动作（非 Chat）

1. 打开 `/editor`，选花园，标题「本地优先笔记法」。
2. 写正文、贴图、打标签，保存/发布。

### 系统行为

`post.create`/`update` → SQLite + `content/{garden}/{slug}.md`；自动保存节流/防抖。

### 前端呈现

实时预览；`/posts` 出现；`/posts/[slug]` 可读。

### 与 Chat 衔接

用户也可在 Chat 写好后点「写入知识库」（见场景 14），不必手抄。

### 验收

Markdown 为事实源；刷新编辑器不丢已保存内容。

---

## 场景 9：流式中连续发送 / 队列

### 理想用户发言

1. 先发：「总结一下上面三篇笔记的共同点。」（Agent 开始流式）
2. 流式未结束再发：「顺便列出分歧点。」
3. 再发：「最后给一个行动建议。」

### Agent 理想动作

1. 先跑完当前轮（或按产品队列语义消费）。
2. 排队消息按序成为新的 user 轮，**不丢**、不互相覆盖。
3. 每条都完整回答，不假装「三条已合并成一条」除非产品明确合并。

### 系统 / 前端

`userQueue` + drain；输入框上方可见排队；见 `chat-scenario-states.md` §4。

### 验收

三条都有对应回复；刷新后队列与历史可水合。

---

## 场景 10：刷新 / 切会话后续传

### 理想用户动作

Agent 正在长文流式输出时按 F5，或切到别的会话再切回。

### Agent / 系统理想行为

1. 服务端 StreamHub 续传 + 已落库消息为权威。
2. 前端水合后继续显示最终结果；不出现「整段消失只剩 Thinking」。
3. 子 Agent 在跑时，父会话回来仍能看到派工与后续投递。

### 验收

E2E：`chat-resume-mock` / `chat-subagent-resume-mock`；用户**不被**教导「刷新一下就好」当修复。

---

## 场景 11：阅读 LiveDoc + 划词解释

### 理想用户动作

打开某篇笔记 → 选中一段难懂公式文字 → 点「解释」。

### Agent 理想动作

1. 仅解释选区，**不**改写正文、不 `post_update`。
2. 用浅显中文 + 必要公式；可引用上下文标题。

### 系统

`explainSelection`（或等价）；结果在侧栏/浮层。

### 验收

原文不变；解释可关闭重开。

---

## 场景 12：编辑器选区 AI 改写

### 理想用户动作

在编辑器选中第 2 节一段话 → 工具条选「精简」或输入「更可引用、加出处占位」。

### Agent 理想动作

1. 只改选区；Accept 才写回。
2. 不擅自改标题/其他章节。

### 系统

`editorAgentComplete`；Accept / Discard。

### 验收

Discard 后原文恢复；Accept 后进自动保存管道。

---

## 场景 13：相关笔记推荐

### 理想用户动作

读完一文滑到页底，看「相关笔记」。

### 系统理想行为

`post.related`（FTS + 标签 + 同花园）给出可点链接；无相关时空态友好。

### 验收

点开是真文；不出现死链。

---

## 场景 14：Chat → 知识库落库

### 理想用户发言 / 动作

1. Chat：「把你上条关于 DDPM 采样的总结写成 knowledge 花园草稿。」
2. 或点助手气泡「写入知识库」→ 选新建 / 覆盖 / 追加。

### Agent 理想动作

1. 若走工具：在用户确认花园/标题后 `post_create` / 等价 `createFromChat`。
2. **禁止** `write_file` 直写 `content/posts`。
3. 落库后给出可点路径/slug。

### 验收

正文来自服务端 messageId；花园 Markdown 可 sync。

---

## 场景 15：中栏派工条

### 理想用户发言

> 同时派两个资料员：一个查论文，一个查博客，都非阻塞。

### Agent 理想动作

1. 两次 `spawn_subagent(waitForResult=false)`（或合理并行策略）。
2. 口头说明两个名字/任务；之后靠派工条与投递，不刷 status。

### 前端

`ChatDispatchStrip` 显示进度；可点进子会话。

### 验收

开着父会话即可盯进度，无需手刷左栏。

---

## 场景 16：本地模型对话

### 理想用户发言

1. 模型菜单切到 `ollama/llama3.2`（或等价）。
2. 「把下面乱笔记整理成大纲，先别上网。」+ 粘贴私密笔记。

### Agent 理想动作

1. 走本地端点；不调用需云 Key 的工具除非用户允许。
2. 本地不可达时明确报错「未连接 Ollama」，不装死。

### 验收

无云 Key 也能完成整理；切回云模型后历史仍在同 Session。

---

## 场景 17：Inbox 抓取 → 蒸馏成文

### 理想用户发言

> 把 Inbox 里未处理的 3 条链接抓正文，蒸馏成一篇「本周阅读」草稿进 knowledge，标签加 `周刊`。

### Agent 理想动作

1. `inbox_list` / `inbox_stats` 看增量。
2. 逐条 `inbox_enrich` 或 `read_article`；登录墙先 `browser_login_status` → `platform_login`。
3. 写出结构化周刊草稿 → 请用户确认后 `post_create` / 落库对话框。
4. 可选：`inbox_distill`（若启用）走产品蒸馏管道。

### 关键工具

`inbox_*`、`read_article`、`platform_login`、`post_create`。

### 验收

草稿可打开编辑；来源链接保留。

---

## 场景 18：视频转文字 / 本地 STT 做笔记

### 理想用户发言

> 把这个视频做成学习笔记，能写进 knowledge：  
> https://www.bilibili.com/video/BVxxxxxx  
> 有字幕用字幕；没有就下载音频本地转写，不要编台词。

### Agent 理想动作

1. `skill_view(name="video-notes")`（可选）。
2. 先 `video_transcript`；有正文 → 提炼要点。
3. 无字幕：短片 `video_notes`；长片 `async_task_run` → `media_download` + `audio_transcribe`。
4. `read_file(transcriptPath)` 读全文 → 整理笔记 → 用户确认后 `post_create`。
5. 本机未装 faster-whisper / yt-dlp 时给出安装提示，不假装已转写。

### 关键工具

`video_transcript`、`media_download`、`audio_transcribe`、`video_notes`、`read_file`、`post_create`；Skill `video-notes`。

### 验收

有字幕或本地 STT 之一产出可读逐字稿；可成文；开着 Chat 能看到进度（长任务走投递）。

---

## 场景 19：平台登录后读文

### 理想用户发言

> 我要读知乎收藏夹里这篇专栏（贴 URL）。若未登录请弹浏览器登录，登录后读全文分段总结。

### Agent 理想动作

1. `browser_login_status` → 未登录则 `platform_login(platform="zhihu")`，等用户在弹出浏览器完成登录。
2. **禁止**用 `browser_screenshot` + `vision_describe` 代替登录读文。
3. `read_article`（`offset`/`nextOffset` 翻页）→ 分段总结 → 可选 `save_webpage` 留本地。

### 关键工具

`browser_login_status`、`platform_login`、`read_article`、`save_webpage`。

### 验收

登录态落 storageState；读到正文而非反爬拦截页。

---

## 场景 20：深度调研 Goal

### 理想用户发言

> 设 Goal：两天内搭好「扩散模型采样」主题花园初版，含目录 + 至少 3 篇达标长文；今晚先跑，我明天早上看。

### Agent 理想动作

1. `skill_view(name="knowledge-garden")` 或 `deep-research` 按需加载。
2. `session_goal_set` 写清完成标准（字数/链接/结构）。
3. `garden_create` / `post_create` 循环调研；过夜依赖机器与 `pnpm dev` 仍在跑（重启不自动续跑——须在回复里说清）。
4. `session_goal_status` 自检；未达标继续，不堆空壳文。

### 关键工具

Goal + garden/post + 调研工具集。

### 验收

明早打开可见实质进度；不是 200 字占位灌水。

---

## 场景 A：晨间简报 → 花园笔记

### 理想用户发言

> 把昨夜 Inbox / 订阅源新增汇总成 5 条要点；挑 1～2 条值得沉淀的写成 knowledge 草稿，标签 `日报`。本地模型可先粗摘要。

### Agent 理想动作

1. `inbox_list` / 源同步状态 → 拉增量。
2. 必要时 `read_article` / `platform_login`。
3. 输出「5 要点 + 建议落库 1～2 条」；等用户点写入或明确「写吧」再落库（`createFromChat` / `post_create`，mode 追加「每日简报」或新建）。
4. 若昨夜已派非阻塞任务：只消费投递，不重复全量抓取。

### 前端

简报气泡 + 派工条昨夜 done + 落库对话框。

### 验收

≤ 3 分钟到草稿；正文可追溯 messageId。

---

## 场景 B：专题深挖 → 阻塞调研 → 成文

### 理想用户发言

> 调研 DDPM 采样技巧，对比我花园里已有的 diffusion 笔记，写一篇可发布草稿；资料员同步等结果。

### Agent 理想动作

1. `post_list` + 读旧文，列出已有观点，避免重复科普。
2. `spawn_subagent(waitForResult=true)` 资料员：`web_search` + `read_article` + `save_webpage`。
3. 父写「增量」结构：摘要 / 对比表 / 待验证点。
4. 用户确认后落库；相关推荐挂到旧文。

### 验收

阻塞调研完成后可直接成文；相关笔记可点。

---

## 场景 C：本地草稿 + 云精修 + 选区打磨

### 理想用户发言

1. （模型=本地）「整理成学习笔记，先别发网上。」+ 私密粘贴。
2. （切云模型）「只改第 2 节，更短、更可引用。」
3. （编辑器）对某段「精简」。

### Agent 理想动作

1. 本地轮：不外传、不乱搜。
2. 云轮：只动指定节。
3. 选区：Accept 才写回。

### 验收

同一篇文章闭环；改 slug 后图片 URL 仍稳定（uploads 按 postId）。

---

## 场景 D：本地压图配文（PicLite 图轻）

> **来源灵感**：[PicLite 图轻：2MB 的开源压图神器，本地处理不传服务器](https://mp.weixin.qq.com/s/2FN1SDymF-h-0c6qUyUxGg)（善忘技术夹）  
> **产品落点**：见微同样「本地优先」——配图压缩不走陌生在线压图站；Agent 侧用 Skill `piclite-compress` 编排（桌面 PicLite / 本机 CLI / 可控脚本），再把结果放进 `content/uploads/` 供文章引用。

### 理想用户发言（三种口吻都要会）

**D1 公众号/博客配图**

> 这几张相机原图在 `workspaces/__assistant__/raw-photos/`，要进 knowledge 文章当配图。单张压到约 1MB 内、最长边 ≤1600，不要上传到任何在线压图网站。压完告诉我路径，我好写进 Markdown。

**D2 批量产品图 / GIF**

> 把 `raw-photos/demo.gif` 压到 3MB 以下还能动；同目录 PNG 转 WebP。全程本地。

**D3 隐私截图**

> 这些是含内部数据的截图，压缩时清掉 EXIF/GPS，绝不经过第三方服务器。

### Agent 理想动作

1. `skill_view(name="piclite-compress")` 加载流程与约束。
2. `list_directory` 确认源文件；敏感路径不外传 URL。
3. 按 Skill：优先本机 PicLite（用户已装桌面版/自托管）或文档允许的本地命令；**禁止**把原图 POST 到 TinyPNG 类 SaaS。
4. 输出落到 Workspace 或 `content/uploads/{garden}/…`（经产品上传/复制约定），回报：原体积 → 新体积、相对路径。
5. 若用户同时要成文：再 `post_create`/`post_update`，正文用 Markdown 图片语法引用 uploads，不 `write_file` 直写 posts。
6. PicLite 未安装时：给出 GitHub Releases / 官方安装步骤，并询问是否改用本机已有 `ffmpeg` 等**本地**后备（仍不上传第三方）。

### 系统 / 前端

1. 工具卡可见 `skill_view` / `list_directory` / `run_shell`（或文件工具）。
2. 文章预览中图片来自 `/uploads` 或 posts assets，不热链外网临时盘。

### 关键工具 / Skill

- Skill：`piclite-compress`
- `list_directory`、`run_shell`（本地）、上传/复制到 `content/uploads`
- 成文：`post_create` / `post_update` / Chat 落库

### 验收

1. 图体积明显下降且文章可显示。  
2. 无第三方压图上传。  
3. 用户开着 Chat 能看到步骤与最终路径，无需 F5。

---

## 场景 E：微信/网页文章 → Remotion 成片

> **来源灵感**：[video-skills-toolkit：先把声音钉在时间线上](https://mp.weixin.qq.com/s/YqnCTo8F6k2EbX3jD0icPg)（[GitHub](https://github.com/liangdabiao/video-skills-toolkit)）  
> **见微落点**：不依赖 Ideaflow；`article_material_pack` 本地材料包 → AI 填 `beats.json` → `article_video_compose` 注册 Remotion → ```viz 嵌入。Skill：`wechat-article-remotion`。

### 理想用户发言

> 把这篇微信做成 1 分钟讲解短片，画面跟旁白走：  
> https://mp.weixin.qq.com/s/xxxxxxxx  
> 先出可在花园里播的 Remotion，有配图就用原文图（不要裁切）。

### Agent 理想动作

1. `skill_view(name="wechat-article-remotion")`（+ `references/beat-checklist.md`）。
2. `article_material_pack({ url })` → 得到 `packDir` / `article.md` / `images.json` / `beats.json`。
3. `read_file` 通读文章，**改写** `beats.json` 为 6～12 镜（非模板占位句）；`article-image` 只引用真实 `imageId`。
4. `article_video_compose({ packDir, compositionId: "WechatXxx" })`。
5. `algo_viz_list` 确认 → `post_create`/`post_update` 插 ```viz。
6. 无 TTS 凭证时做无声 + caption；有音频后再按字幕改 `durationSec` 重 compose。
7. **禁止** `write_file` 写 `apps/algo-viz`；**禁止**第三方文章转 MD 黑盒。

### 前端呈现

1. 工具卡：material_pack → compose。
2. 文章内 Remotion Player 可播；可选 Studio / preview 脚本出低清 MP4。

### 关键工具 / Skill

`article_material_pack`、`article_video_compose`、`algo_viz_list`、`download_file`（自动 Referer）、Skill `wechat-article-remotion`。

### 验收

材料包可离线复用；原文图 contain 完整；开着 Chat 能看到工具结果，无需 F5。

---

## 总结（速查）

| 场景 | 用户一句话 | Agent 第一反应 |
|------|------------|----------------|
| 1 | 纯问 | 直接答，不硬搜 |
| 2 | 要近况/出处 | `web_search` → 简述 |
| 3 | 同步等调研 | `spawn_subagent(wait=true)` |
| 4 | 先派再聊 | `wait=false` + 事后投递 |
| 5 | 跑脚本统计 | `async_task_run` |
| 6 | 推远程/删库 | 审批门禁 |
| 7 | 每天自动 | Task/Trigger/心跳 |
| 8 | 手写文章 | 编辑器 Post |
| 9 | 连发三条 | 队列不丢 |
| 10 | 刷新 | 续传+水合 |
| 11 | 划词 | 只解释不写回 |
| 12 | 选区改写 | Accept 才落盘 |
| 13 | 读完 | 相关笔记 |
| 14 | 聊完入库 | createFromChat / post_* |
| 15 | 多子任务 | 派工条 |
| 16 | 隐私草稿 | 本地模型 |
| 17 | 收藏蒸馏 | inbox → 文 |
| 18 | 视频 | `video_transcript` |
| 19 | 知乎深读 | login → read_article |
| 20 | 过夜调研 | Goal + garden |
| A | 晨间简报 | inbox → knowledge |
| B | 专题成文 | 阻塞资料员 |
| C | 本地+云+选区 | 模型切换+编辑器 |
| D | 本地压图 | Skill piclite-compress |
| E | 文章成片 | material_pack → compose |

状态机级细节见 [`chat-scenario-states.md`](./chat-scenario-states.md)。
