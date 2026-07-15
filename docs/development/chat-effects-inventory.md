# Chat useEffect 群落清点造册（W13d）

> 日期：2026-07-14 · 分支 `fix/p0-agent-budget-hitl` · 工单 W13d（chat.tsx 拆分最后阶段）
>
> 基线：W13c 完成后 `chat.tsx` 2504 行、**23 个 useEffect**。
> 结果（已实施完成）：`chat.tsx` 2294 行、内 **8 个 useEffect**（每个带归属注释）+ 抽出 5 个 `lib/useChat*.ts`（合计 8 个），
> **总计 23 → 16，只减不增**；`queueMicrotask()` 调用不新增（全文仍 1 处，drain 重入边界）；
> INV-1~8 / drain 触发链 / 状态机语义零改动。
>
> 验证口径（W16b-3 如实订正）：mock e2e 18/18 **零回归**；另含 **4 处静默改善**
> （见 §4 末尾清单）。早期文本中「逐点等价 / 语义等价」的 blanket 声称以该清单为准——
> 等价的是 INV 状态机语义与最终持久化内容，不是每个中间态都逐点相同。

---

## 1. 清册：原 23 个 useEffect 的处置

行号为 W13d 动手前（W13c 后）`chat.tsx` 行号。

| # | 原行号 | 职责 | 依赖 | 处置 | 理由 / 等价性 |
|---|---|---|---|---|---|
| 1 | :175 | hover preview 开关关闭时清理监控窗 | `[sessionHoverPreviewEnabled]` | **搬走** → `useChatHoverMonitor` | 纯悬停预览域，随该域 state/handler 一并抽出 |
| 2 | :294 | mount 水合三栏 UI 偏好（URL view/panel 优先） | `[searchParams]`（ref 守卫单次） | **归并搬走** → `useChatUiPrefs`（读写合一） | 存储持久化群；水合分支 return 不写，第二轮起写回；最终持久化内容等价，且消除 mount 先写默认值的中间态（§4 改善 1） |
| 3 | :307 | UI 偏好变化写回 localStorage | `[leftOpen,rightOpen,leftTab,historySubTab,rightTab]` | **归并搬走** → `useChatUiPrefs`（同上 1 个） | 同上 |
| 4 | :341 | URL sessionId → state（外部跳转 / 前进后退） | `[sessionFromUrl,sessionId,utils.session.listRunning]` | **保留**（URL 同步群） | 含 INV-8 ③ drain 调用 + listRunning 发现挂接，属编排主干 |
| 5 | :355 | effectiveSessionId → ref 镜像 | `[effectiveSessionId]` | **归并** → ref 镜像群（1 个） | 与 :1369/:1726 同为「render 期值镜像到 ref」，赋值幂等 |
| 6 | :508 | async-running overlay 出现 → 补一次 poll | `[asyncOverlays,effectiveSessionId,asyncQueueQuery]` | **搬走** → `useChatAsyncOverlayEffects` | 纯异步队列 overlay 域；refetch 为稳定引用，deps 等价 |
| 7 | :547 | 发送队列 DB 水合 + INV-8 ④ hydrateDone | `[effectiveSessionId,sessionQueueQuery.data]` | **保留**（队列水合） | INV-8 ④ 触发链关键节点，留编排层 |
| 8 | :564 | 子 Agent pending AgentMessage 幂等镜像入队 | `[effectiveSessionId,isSubagentSession,pullAgentMessagesQuery.data,messages]` | **搬走** → `useSubagentMessageMirror` | 纯子 Agent 镜像域；mutation 随域内聚，effect 体未改 |
| 9 | :613 | async-stream SSE watch + 8 类事件注册/分发 | `[effectiveSessionId,mainSessionId,backendDown,asyncQueueQuery,…]` | **保留**（SSE 订阅与恢复群·心脏区） | 事件分发中枢；cleanup 的 closeSessionWatch 时序不可动 |
| 10 | :820 | consumedDeliveries 按会话从 localStorage 恢复 | `[effectiveSessionId]` | **归并搬走** → `useChatAsyncOverlayEffects`（读写合一） | 与 :836 同域；合一是消除原「切会话先写空再写回」中间态 |
| 11 | :836 | consumedDeliveries 变化写回 localStorage | `[effectiveSessionId,consumedDeliveries]` | **归并搬走** → 同上 | 同上 |
| 12 | :879 | 会话模型/systemPrompt 配置加载与派生 | `[effectiveSessionId,selectedAgent,sessionDetail?.model,sessionDetail?.systemPrompt]` | **搬走** → `useChatConfig` | 纯配置域；updateConfig/resetPromptToAgent/session.update 一并收拢 |
| 13 | :1369 | runStream → ref 镜像 | `[runStream]` | **归并** → ref 镜像群（1 个） | 见 #5 |
| 14 | :1374 | mount：sessionStorage 恢复三层 store + 自动续传 | `[]` | **保留**（SSE 订阅与恢复群·心脏区） | INV-8 ④ drain 请求源；续传时序经 e2e（chat-resume/subagent-resume）覆盖 |
| 15 | :1457 | beforeunload 持久化 + 卸载标记 | `[]` | **归并** → 页面生命周期群（1 个） | 与 :1470/:1766/:1789 同为 deps []，mount/unmount 两边界互不交互 |
| 16 | :1470 | visibilitychange：切回标签页续传断流 | `[]` | **归并** → 页面生命周期群（同上） | 同上 |
| 17 | :1491 | listRunning 发现运行中会话 → 挂接（INV-5） | `[runningSessionsQuery.data]` | **保留**（SSE 订阅与恢复群·心脏区） | INV-5 挂接进度一致性所在，一行不许动 |
| 18 | :1726 | drainAllPendingQueues → consumeRef 镜像 | `[drainAllPendingQueues]` | **归并** → ref 镜像群（1 个） | 见 #5 |
| 19 | :1733 | onStreamCommitted 订阅 → drain（INV-8 ②④ 消费点） | `[]` | **保留**（SSE 订阅与恢复群·心脏区） | drain 触发链唯一钩子；含晚订阅补偿 takeDrainRequests |
| 20 | :1749 | 过期 async overlay 1s 节拍清理 | `[effectiveSessionId]` | **搬走** → `useChatAsyncOverlayEffects` | 独立 effect 保留：interval 不可与高频 deps 混（重建永不到点） |
| 21 | :1766 | unmount 清理 rAF / 防抖定时器 | `[]` | **归并** → 页面生命周期群（1 个） | 见 #15 |
| 22 | :1789 | Ctrl+Shift+S 快捷键 | `[]` | **归并** → 页面生命周期群（同上） | 见 #15 |
| 23 | :1801 | toast 2.5s 自动消失 | `[toast]` | **删除** | 改为 `showToast` 内联重置定时器（传 null 停表）：不同文案路径语义等价；相同文案连续触发改为重新计时（§4 改善 3） |

---

## 2. 归并结果总览

### chat.tsx 内保留 8 个（每个带归属注释）

| # | 归属 | 说明 |
|---|---|---|
| 1 | **【URL 同步群】** | URL → state；反向（state → URL）在 selectSession/startNewChat/onSessionStart 事件处理内 |
| 2 | **【队列水合·INV-8④】** | 发送队列 DB 水合 → hydrateDone 显式 drain 请求 |
| 3 | **【SSE 订阅与事件分发】** | async-stream watch + 8 类 SSE 事件注册/cleanup（心脏区，体未改） |
| 4 | **【mount 恢复与续传】** | sessionStorage 恢复三层 store + 自动续传（心脏区，体未改） |
| 5 | **【页面生命周期与全局监听群】** | beforeunload + visibilitychange + keydown + unmount 清理（4 → 1，均 deps [] 两边界不交互） |
| 6 | **【listRunning 挂接·INV-5】** | 服务端运行发现 → resumeAfter 与本地进度对齐（心脏区，体未改） |
| 7 | **【ref 镜像群】** | effectiveSessionIdRef + runStreamRef + consumeRef（3 → 1，赋值幂等） |
| 8 | **【drain 订阅·INV-8②④】** | onStreamCommitted → queueMicrotask drain + 晚订阅补偿（心脏区，体未改） |

### 抽出 5 个 hook（`apps/web/lib/`，合计 8 个 effect）

| 文件 | effect 数 | 收拢内容 |
|---|---|---|
| `useChatUiPrefs.ts` | 1 | UI 偏好读写合一（原 :294+:307） |
| `useChatConfig.ts` | 1 | 会话配置加载（原 :879）+ updateConfig/resetPromptToAgent/session.update |
| `useChatHoverMonitor.ts` | 2 | 开关清理（原 :175）+ unmount 防抖定时器清理（原 :1766 的 hover 段随域搬走） |
| `useSubagentMessageMirror.ts` | 1 | 子 Agent 消息镜像（原 :564，体未改） |
| `useChatAsyncOverlayEffects.ts` | 3 | poll 触发（原 :508）+ 过期清理（原 :1749）+ 消费记录读写合一（原 :820+:836） |

**合计：8（chat.tsx）+ 8（hooks）= 16 个，较原 23 个净减 7。**

---

## 3. 无法消除的 8 个 effect 及理由

1. **URL 同步**：URL 是外部真相源（浏览器前进/后退/外部跳转），必须 effect 桥接；含 INV-8 ③ drain 调用，无法声明式化。
2. **队列水合（INV-8④）**：`sessionQueueQuery.data` 到达是异步事件，水合 + hydrateDone 必须 effect；改写为事件回调需 React Query 层发明新钩子，得不偿失。
3. **SSE 订阅与事件分发**：EventSource 生命周期（watch/close）与 React 渲染天然是 effect 域；cleanup 的引用计数 close 是 INV 体系的一部分。
4. **mount 恢复与续传**：mount-once 语义本身就是 effect；续传调用必须发生在首帧提交后。
5. **页面生命周期与全局监听**：beforeunload/visibilitychange/keydown 是命令式 DOM API，只能 effect 注册/注销。
6. **listRunning 挂接（INV-5）**：`runningSessionsQuery.data` 到达驱动挂接，挂接进度计算依赖 store 运行时读，属典型「外部数据 → 命令式动作」。
7. **ref 镜像**：latest-ref 模式的标准 effect 形态；合并后仅 1 个。
8. **drain 订阅（INV-8②④）**：store 外部订阅（onStreamCommitted）只能 effect 挂载；queueMicrotask 是 dispatch 重入边界（注释已注明，非时序猜测）。

---

## 4. 关键等价性论证

- **ref 镜像群（3→1）**：三个赋值互不依赖、均幂等；合并 effect 位于 drainAllPendingQueues 定义后，mount 批内先于 :1733 的 `takeDrainRequests → queueMicrotask` 消费点（microtask 在全部 mount effects 后执行），时序等价。
- **页面生命周期群（4→1）**：原四 effect 均 deps []，注册只发生在 mount、清理只发生在 unmount，彼此无交互；合并后注册/清理逐条一一对应。hover/toast 定时器清理随域调整（hover 段入 `useChatHoverMonitor`，toast 段入 `showToast` 配套 ref）。
- **UI 偏好 / 消费记录「读写合一」**：统一采用「首轮水合 return 不写；水合引发的 state 更新触发第二轮起走写回分支」模式。消除了原实现 mount 时「先写默认值/空集再写回水合值」的中间态，最终持久化内容一致（静默改善 1/2）。
- **toast effect 删除**：`showToast(msg)` 内联 `clearTimeout + setTimeout(2500)`，传 null 停表清除。不同文案路径与原「toast state 变化 → effect 重置计时」逐点等价（含 chatSidebar 自持的 `setToast(null)` 路径，经 prop 类型 `(msg: string | null) => void` 兼容）；**相同文案连续触发时不等价、为改善**：原实现 `setToast(同值)` 被 React bailout、`[toast]` effect 不重跑、定时不重置，第二条相同 toast 会随第一条的定时提前消失；内联后每次调用都重新计时（静默改善 3）。
- **:1749 保持独立**：setInterval 若与 asyncOverlays/consumedDeliveries 等高频 deps 合并，interval 会被反复 clear/重建而永不到点，故单设 effect，deps 仅 `[effectiveSessionId]`。

### 4 处静默改善（W16b-3 如实补记：相对 W13c 基线的行为 Delta，均经 e2e 验证非回归）

1. **UI 偏好 localStorage 读写合一**（原 :294+:307 → `useChatUiPrefs`）：原实现 mount 批内
   写回 effect 在水合 setState 生效前先把**默认值**写入 localStorage，第二轮才覆写为水合值；
   读写合一后该中间态消除，mount 期间 localStorage 不再被默认值污染。
2. **consumedDeliveries 读写合一**（原 :820+:836 → `useChatAsyncOverlayEffects` ③）：
   原实现切会话时先把**空集**写回 localStorage、再写回水合值；中间态消除后，
   窗口期刷新不再丢失已消费记录（旧异步结果不再因记录丢失而重复展示）。
3. **toast 相同文案连续触发重新计时**（原 :1801 effect 删除 → `showToast` 内联）：
   原实现 `setToast(同值)` 触发 React bailout、`[toast]` effect 不重跑、定时不重置，
   第二条相同 toast 会随第一条的定时提前消失；内联后每次 `showToast` 调用都重新计时。
4. **effect 总数 23 → 16（净减 7）**：每次提交期的 effect 注册 / deps 比对开销净减
   （结构性运行时收益，不改语义）。

## 5. 验证记录（归并实施实际执行）

> 实施被首次会话打断后，由续作会话按本造册重新执行；以下为实际轮次记录。
> 每轮 = `pnpm run test:e2e:mock:prep && pnpm run test:e2e:mock`（18 spec，workers 1）。

| 轮次 | 范围 | 结果 |
|---|---|---|
| 基线复测 | W13c 后未动代码 | **18 passed**（chat-subagent-resume-mock:102 既有 flake 本轮未出现） |
| Step A | ref 镜像群 3→1 + 页面生命周期群 4→1 + toast 内联 | 17 passed + 1 failed（async-task-mock:17）；该 spec 隔离复跑 850ms 通过 → 非回归 |
| Step B | useChatUiPrefs / useChatConfig / useChatHoverMonitor | 16 passed + 2 failed（chat-subagent-resume-mock:102 既有 flake + async-task-mock:17）；两 spec 隔离复跑 5/5 通过 → 非回归 |
| Step C | useSubagentMessageMirror / useChatAsyncOverlayEffects | 17 passed + 1 failed（async-task-mock:17 同签名） |
| 最终复跑 | 8 个归属注释补齐 + exhaustive-deps warning 修复后 | **18 passed** ✓（async-task-mock / chat-subagent-resume-mock:102 均通过，再次证实二者为 flake） |

**关于 `async-task-mock:17`（全量轮 3 次出现、隔离复跑 3 次全过）**：该 spec 是全量套件第一个测试，
失败签名为「10s 内 `async-progress-step` 未出现」；失败时页面快照显示消息已发出、
`async_task_run` 工具已启动（执行中 · 5ms）——流整体启动延迟，属首个测试吃掉冷启动成本的
环境 flake（本机负载升高时全量轮总时长 50s → 60~90s）。其依赖的链路（onToolEnd →
patchAsyncOverlays → mergeAsyncPollIntoQueue → useAsyncProgressSteps）不在本工单任何改动面上
（Step A 仅动 toast / 生命周期监听 / ref 镜像即已观察到同签名失败）。
