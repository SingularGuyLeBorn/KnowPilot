# Gap 1 调试记录：父会话时间线实时显示任务进度

> 记录时间：2026-07-10
> 分支：`feat/hover-monitor`
> 目标：实现并验证「父会话时间线实时显示后台任务进度」
> 当前状态：UI 与后端逻辑已落地，E2E 断言仍不稳定，需调整生命周期

---

## 1. 需求背景

KnowPilot Chat 支持三类异步任务：

- `run_async`（后台任务）
- `async_task_run`（异步任务队列）
- `spawn_subagent`（子 Agent，可配置 `waitForResult=true`）

当这些工具在父会话中被调用时，用户需要**在父会话时间线里实时看到任务正在运行**，而不是只在左侧「异步任务」标签页里看。Gap 1 就是补齐这个实时进度条。

---

## 2. 已实现的内容

### 2.1 类型层：`TimelineStep` 增加 `progress`

文件：`apps/web/lib/chatMessageUtils.ts`

```ts
export type TimelineStep =
  | { type: "thinking"; content: string; round: number }
  | { type: "content"; content: string; round: number }
  | { type: "tool"; toolCallId: string; name: string; args: unknown; result?: unknown; hint?: string | null; round: number; status: "running" | "done" }
  | { type: "progress"; jobId: string; label: string; round: number; status: "queued" | "running" | "done" | "failed"; content?: string };
```

### 2.2 展示层：新增 `ProgressStep` 组件

文件：`apps/web/components/chatTimelineSteps.tsx`

- 四种状态图标：排队中（Clock）、运行中（Loader2 旋转）、已完成（Check）、失败（X）
- 不同状态使用不同边框/背景色
- 失败时展示 `content` 摘要
- `ThinkingTimeline` key 生成增加 `progress-${jobId}` 分支

### 2.3 逻辑层：从 `asyncResultQueue` 派生进度

文件：`apps/web/components/chat.tsx`

```tsx
const asyncProgressSteps = useMemo<TimelineStep[]>(() => {
  const steps: TimelineStep[] = [];
  for (const item of asyncResultQueue) {
    if (item.kind === "async-running") {
      steps.push({
        type: "progress",
        jobId: item.jobId ?? item.id,
        label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
        round: 1,
        status: item.status === "queued" ? "queued" : "running",
      });
    } else if (item.kind === "async-result" && item.status) {
      steps.push({
        type: "progress",
        jobId: item.jobId ?? item.id,
        label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
        round: 1,
        status: item.status === "failed" ? "failed" : "done",
        content: item.status === "failed" ? item.asyncResult : undefined,
      });
    }
  }
  return steps;
}, [asyncResultQueue]);
```

渲染位置在输入框上方：

```tsx
{asyncProgressSteps.length > 0 && (
  <div className="flex w-full justify-start px-4 pb-3 md:px-6" data-testid="async-progress-block">
    <ThinkingTimeline steps={asyncProgressSteps} isLive />
  </div>
)}
```

### 2.4 触发层：`onToolEnd` 创建本地 `async-running` overlay

文件：`apps/web/components/chat.tsx`

当工具返回 `running`/`queued` 时，立即往当前会话的 `asyncOverlays` 写入一条 `kind="async-running"` 的 overlay：

```tsx
if (
  (name === "run_async" || name === "async_task_run" || name === "spawn_subagent") &&
  result && typeof result === "object"
) {
  const r = result as { jobId?: string; status?: string; message?: string; subagentSessionId?: string; subagentName?: string };
  if (r.jobId && (r.status === "running" || r.status === "queued")) {
    ssSet(originSid, "asyncOverlays", (prev) => {
      if (prev.some((q) => q.jobId === r.jobId)) return prev;
      const label = r.message || r.subagentName || `${name === "spawn_subagent" ? "子 Agent" : "后台任务"} ${r.jobId.slice(0, 6)}`;
      return [
        {
          id: `run-${r.jobId}`,
          kind: "async-running" as const,
          text: r.message || "",
          jobId: r.jobId,
          taskLabel: label.slice(0, 60),
          status: r.status === "queued" ? "queued" : "running",
          subagentSessionId: r.subagentSessionId,
          subagentName: r.subagentName,
          createdAt: Date.now(),
        },
        ...prev,
      ];
    });
  }
}
```

### 2.5 后端 Mock LLM 修复

文件：`apps/server/src/infra/agentStream.ts`（Mock 分支）

`async_task_run` 分支原本只返回了工具结果，没有输出最终 content，导致结果消息不会生成。已补充最终 assistant content，使异步任务完成后能正常产生对话气泡。

### 2.6 E2E 断言

文件：`apps/web/e2e/async-task-mock.spec.ts`

```ts
await expect
  .poll(async () => page.getByTestId("async-progress-step").count(), {
    timeout: 10_000,
    intervals: [200],
  })
  .toBeGreaterThanOrEqual(1);
```

---

## 3. 调试过程与关键日志

### 3.1 第一次失败：从 `asyncOverlays` 派生时

最初进度从 `asyncOverlays` 派生。调试日志显示：

```
[debug progress] asyncOverlays 0 []
[debug progress] asyncOverlays 0 []
[debug onToolEnd] run_async {"jobId":"...","status":"running","message":"已启动后台任务..."}
[debug progress] asyncOverlays 1 [Object]
[debug progress] asyncOverlays 0 []
```

即 overlay 只存在**一次渲染**就被清掉了，Playwright 200ms 轮询未能命中。

### 3.2 第二次失败：改为从 `asyncResultQueue` 派生

改为从合并后的 `asyncResultQueue` 派生后，日志变成：

```
[debug progress] asyncResultQueue 0 []
[debug progress] asyncResultQueue 0 []
[debug onToolEnd] run_async {"jobId":"...","status":"running","message":"已启动后台任务..."}
[debug progress] asyncResultQueue 1 [Object]
[debug progress] asyncResultQueue 1 [Object]
[debug progress] asyncResultQueue 0 []
[debug progress] asyncResultQueue 0 []
```

看起来已经有两次渲染携带了 progress 项，但 E2E 仍然失败。

### 3.3 截图分析

失败截图显示：

- 工具 pill `run_async 执行中 · 4ms` 已出现
- 助手气泡已经产生（包含「已启动后台任务...」）
- 输入框上方**没有进度条**

这说明当截图被捕获时进度条已经消失，符合「闪现」特征。

---

## 4. 根因分析

### 4.1 overlay 被过早清除

关键代码在 `consumeQueue`：

```tsx
if (task.kind === "async-result" && task.jobId) {
  ssSet(sid, "consumedDeliveries", (s: Set<string>) => new Set(s).add(task.jobId!));
}

// ...

} else {
  // async-result：标记 consumedDeliveries，asyncOverlays 中对应的 overlay 也清除
  st.activeQueueTaskId = task.id;
  if (task.jobId) {
    ssSet(sid, "asyncOverlays", (prev) => prev.filter((o) => o.jobId !== task.jobId));
  }
}
```

当 `pullAsyncQueue` 第一次轮询拿到 delivery 后，`consumeQueue` 会立即：

1. 把 `jobId` 加入 `consumedDeliveries`
2. 把 `asyncOverlays` 中对应 `jobId` 的 overlay 过滤掉

由于 Mock 流式响应极快（约 240ms），工具返回 running 后很短时间就完成了任务并触发消费，导致 progress 项在 DOM 中只存在极短的时间。

### 4.2 Playwright 轮询窗口不够小

测试使用 `intervals: [200]`，即使进度条在两次轮询之间闪现，也无法被检测到。缩短间隔（如 50ms）可以提高命中率，但无法解决根本的稳定性问题。

### 4.3 生产 UX 同样受影响

即使 E2E 通过，真实用户在快速完成的任务场景下也只会看到进度条「一闪而过」，体验并不好。因此这个问题不应只在测试层修，而应该在产品层让进度状态更稳定。

---

## 5. 待决策的修复方向

### 方案 A：把 overlay 清除延迟到结果流完成后

当前 `consumeQueue` 在消费 async-result 时立即清 overlay。可以改为：

- 不清除 overlay
- 把 `activeQueueTaskId` 设置为 overlay 的 id（`run-${jobId}`）
- 让 `runStream` 的 `finally` 块在结果总结流结束后再清除 overlay

优点：改动最小，progress 会一直显示到结果进入对话。

缺点：progress 状态停留在「运行中」，不会显示「已完成」。

### 方案 B：把 overlay 转为 `done`/`failed` 并保留 N 秒

在 `consumeQueue` 消费 async-result 时，不删除 overlay，而是把它从 `async-running` 改为 `async-result` 状态 `done`/`failed`。然后设置一个 3~5 秒的定时器再真正移除。

优点：用户能看到「运行中 → 已完成」的完整状态流转。

缺点：需要修改 `mergeAsyncPollIntoQueue` 对本地 `async-result` overlay 的处理，避免与 poll delivery 重复；同时需要管理定时器清理。

### 方案 C：新增独立的 `taskProgress` 状态

在 `SessionStreamState` 中新增 `taskProgress: Map<jobId, ProgressItem>`，与队列解耦。

- `onToolEnd` 写入 running
- `consumeQueue` 更新为 done/failed
- 用 `useEffect` 在 N 秒后自动清理已完成项

优点：语义最清晰，不影响现有队列消费逻辑。

缺点：需要新增状态、序列化/反序列化逻辑（刷新恢复）。

### 推荐

当前阶段推荐 **方案 A 或 B**，因为改动范围小且能直接解决 E2E 稳定性问题。若后续要支持更复杂的任务状态展示（如百分比、子步骤），再考虑方案 C。

---

## 6. 其他未处理项

### 6.1 Hover Monitor 小窗口

文件：`apps/web/components/chatHoverMonitor.tsx`

组件已创建并接入左栏 hover 事件，但完整行为与样式尚未打磨。当前优先级低于 Gap 1 进度条问题，计划在进度条稳定后继续。

### 6.2 子 Agent 结果可见性回归

此前修复过一个回归：父会话中 `source=sub` 的结果气泡被错误地按 `isUserLike` 渲染到右侧并隐藏。该修复已提交到 master（`ebaa639d`），当前分支已包含。

---

## 7. 验证命令

```bash
# lint + 单元测试
pnpm lint
pnpm test

# mock E2E（当前 async-task-mock 仍失败）
pnpm --filter @knowpilot/web build:mock
pnpm --filter @knowpilot/web test:e2e:mock -- --grep "async_task_run 后台任务完成后结果自动插入对话"
```

---

## 8. 结论

Gap 1 的功能代码已经写通，本地状态里也能看到进度项。但因为它「闪现即消失」，导致自动化测试无法稳定捕获。下一步需要在**队列消费/overlay 生命周期**层面做调整，让进度条至少保留到结果流结束或显示完成态数秒，而不是在 `consumeQueue` 消费 async-result 的瞬间就被清除。


---

## 9. 修复实施（2026-07-10）

### 9.1 采用方案 B：running overlay 转为 done/failed 并保留 5 秒

**改动文件：**
- `apps/web/lib/chatQueueTypes.ts`
- `apps/web/components/chat.tsx`
- `apps/web/e2e/async-task-mock.spec.ts`

### 9.2 核心改动

#### 1) `ChatQueueItem` 新增 `removeAt`

```ts
/** 已完成的 overlay 自动移除时间戳（ms），仅本地 async-result 使用 */
removeAt?: number;
```

#### 2) `consumeQueue` 不再删除 overlay，而是更新状态

消费 `async-result` 时：
- 找到同 `jobId` 的本地 `async-running` overlay
- 将其改为 `kind="async-result"`
- 设置 `status: done | failed`、`asyncResult`、以及 `removeAt: Date.now() + 5000`
- `activeQueueTaskId` 指向稳定 id `run-${jobId}`

这样父会话时间线会从「运行中」自然过渡到「已完成/失败」，不会再一闪而过。

#### 3) 新增过期清理 effect

每秒检查一次 `asyncOverlays`，移除 `removeAt <= Date.now()` 的已完成项。保证进度条稳定展示 5 秒后自动消失。

#### 4) `mergeAsyncPollIntoQueue` 避免重复投递

当 poll delivery 到来时，若本地已完成 overlay 仍在 5 秒展示窗口内，则跳过该 delivery，防止：
- 消费后又被 poll 冲掉
- 出现重复的 done/failed 进度项

#### 5) `runStream` finally 不再提前清理 overlay

之前 `finally` 会在流结束后立即按 `activeQueueTaskId` 删除 overlay。现在改为仅重置 `activeQueueTaskId`，清理完全交给 `removeAt` 定时器。

#### 6) 缩短 E2E 轮询间隔

`async-task-mock.spec.ts` 的轮询间隔从 200ms 降到 50ms，提高对快速完成任务的捕获稳定性。

### 9.3 验证结果

```bash
pnpm lint              # 全绿
pnpm test              # shared 33 passed / server 256 passed (5 skipped)
pnpm --filter @knowpilot/web build:mock
pnpm --filter @knowpilot/web test:e2e:mock -- --grep "async_task_run 后台任务完成后结果自动插入对话"
# Mock E2E 18 passed（含目标用例）
```

目标用例 `async_task_run 后台任务完成后结果自动插入对话` 已稳定通过，父会话时间线能可靠捕获到 `async-progress-step`。

### 9.4 后续可继续优化

- 6.1 中提到的 `ChatHoverMonitor` 小窗口样式与完整行为仍可继续打磨。
- 若未来需要百分比、子步骤等更复杂的任务进度，再考虑升级为方案 C（独立 `taskProgress` Map）。


---

## 10. Hover Monitor 打磨（2026-07-10）

### 10.1 之前问题

- 窗口固定在左上角 (`left-4 top-20`)，会遮挡左侧会话列表。
- 无进入/退出动画，出现/消失生硬。
- 消息预览用 `PostContent` 渲染截断后的 Markdown，小窗口内可能格式错乱。
- 关闭方式只有点 X，不支持 ESC / 点击外部关闭。
- `prefetchInfinite` 调用参数写法不规范。

### 10.2 本次改动

**文件：** `apps/web/components/chatHoverMonitor.tsx`、`apps/web/components/chat.tsx`

1. **位置移到右上角**：`right-4 top-20`，避免遮挡左侧栏；加 `shadow-2xl` 与圆角。
2. **Framer Motion 动画**：`AnimatePresence` + `motion.div`，spring 进入/退出。
3. **纯文本预览**：新增 `toPlainPreview`，去除 Markdown 标记、图片、代码块，避免小窗口渲染异常。
4. **关闭方式**：
   - 点击外部 (`pointerdown`) 关闭
   - ESC 键关闭
   - 保留 X 按钮与进入对话链接
5. **状态映射**：补充 `done` → 「已完成」。
6. **加载/空状态优化**：加载显示「加载中…」+ 旋转图标；空状态显示图标 + 文案。
7. **修复 prefetch**：改为 `utils.message.listForChat.prefetchInfinite({ sessionId: id, limit: 8 })`。
8. **消息计数**：Footer 显示总消息数与展示轮数。

### 10.3 验证

```bash
pnpm lint              # ✅ 全绿
pnpm test              # ✅ shared 33 / server 256 passed
pnpm --filter @knowpilot/web test:e2e:mock  # ✅ 18 passed
```

> 注：Hover Monitor 目前没有专属 E2E，主要依赖现有 Chat 管理页冒烟 (`admin-pages.spec.ts`) 与会话列表交互用例间接覆盖。后续如需专门断言悬浮窗口，可在 `e2e/chat-hover-monitor.spec.ts` 补一个轻量用例。
