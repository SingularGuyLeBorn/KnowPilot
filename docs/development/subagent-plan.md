# Plan: L3 Subagent Support in Agent Chat

## 背景与目标

在 L3 阶段为 KnowPilot 的 Agent 对话界面引入 **Subagent（子代理）** 能力，作为后续 `AgentSwarm` 的简化前置：

1. 在 `/chat` 左侧 panel 上方提供 Subagent 管理区，风格参考 Kimi Code 的步骤/工具卡片（可折叠、带状态圆点、图标、运行详情）。
2. 后台能追踪“哪个 Session 启动了哪个 Subagent”。
3. 每个 Subagent 以独立 `ChatSession` 形式存在，可被查看详情、删除、停止、重跑。
4. 保留扩展性：后续迁移到专门的 `AgentSwarm` 时不伤筋动骨。

---

## 关键假设

- **Subagent 由用户在 Chat UI 内手动创建**，Agent 后续也可通过 `native:spawn_subagent` 工具调用创建。
- 左侧 panel 上方放置：**当前 Agent 切换 + Subagent 卡片列表 + 技能/插件快捷入口**。
- Subagent 卡片操作：查看详情、删除、停止、重跑。

---

## 1. 数据模型与迁移

### 1.1 Prisma schema 改动

文件：`apps/server/prisma/schema.prisma`

```prisma
model ChatSession {
  id              String        @id @default(cuid())
  title           String
  model           String        @default("deepseek-v4-flash")
  systemPrompt    String?
  agentId         String?
  parentSessionId String?       // 新增
  kind            String        @default("chat") // 新增: "chat" | "subagent"
  status          String        @default("active") // 新增: "active" | "running" | "paused" | "completed" | "failed"
  taskDescription String?       // 新增
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  agent           Agent?        @relation(fields: [agentId], references: [id], onDelete: SetNull)
  messages        ChatMessage[]
  runs            Run[]
  parent          ChatSession?  @relation("SessionChildren", fields: [parentSessionId], references: [id], onDelete: SetNull)
  children        ChatSession[] @relation("SessionChildren")

  @@index([parentSessionId, status, updatedAt])
  @@index([kind, status])
}
```

### 1.2 迁移步骤

1. 修改 schema。
2. 本地开发执行：
   ```bash
   pnpm db:push
   ```
3. 生产环境执行：
   ```bash
   pnpm db:migrate --name add_subagent_session_fields
   ```
4. 重新生成 Prisma Client：
   ```bash
   pnpm db:generate
   ```

### 1.3 兼容性与回退

- `kind` 默认 `chat`，不影响现有会话。
- `parentSessionId` 为空表示普通会话。
- 删除父会话时，`onDelete: SetNull` 使子会话变为游离会话，可接受；后续 AgentSwarm 可改为级联或归档。

---

## 2. 共享 Schema 扩展

文件：`packages/shared/src/schemas.ts`

### 2.1 createSessionSchema

```ts
export const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  model: z.string().min(1).max(100).optional(),
  systemPrompt: z.string().max(10000).optional(),
  agentId: z.string().cuid().optional(),
  parentSessionId: z.string().cuid().optional(), // 新增
  kind: z.enum(["chat", "subagent"]).optional(), // 新增
  taskDescription: z.string().max(2000).optional(), // 新增
});
```

### 2.2 updateSessionSchema

```ts
export const updateSessionSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(100).optional(),
  systemPrompt: z.string().max(10000).optional(),
  agentId: z.string().cuid().optional().nullable(),
  status: z.enum(["active", "running", "paused", "completed", "failed"]).optional(), // 新增
  taskDescription: z.string().max(2000).optional(), // 新增
});
```

### 2.3 listSessionsSchema

```ts
export const listSessionsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  agentId: z.string().optional(),
  parentSessionId: z.string().cuid().optional(), // 新增
  kind: z.enum(["chat", "subagent"]).optional(), // 新增
  status: z.enum(["active", "running", "paused", "completed", "failed"]).optional(), // 新增
});
```

### 2.4 新增 stopSessionSchema / rerunSessionSchema

```ts
export const stopSessionSchema = z.object({ id: z.string().cuid() });

export const rerunSessionSchema = z.object({
  id: z.string().cuid(),
  taskDescription: z.string().max(2000).optional(),
});
```

---

## 3. 后端实现

### 3.1 Service 层

文件：`apps/server/src/services.ts`

#### SessionService 改动

1. `buildListWhere` 增加过滤：
   ```ts
   protected buildListWhere(input: ListSessionsInput) {
     const where: any = {};
     if (input.keyword) where.title = { contains: input.keyword };
     if (input.agentId) where.agentId = input.agentId;
     if (input.parentSessionId !== undefined) where.parentSessionId = input.parentSessionId;
     if (input.kind) where.kind = input.kind;
     if (input.status) where.status = input.status;
     return where;
   }
   ```

2. 新增 `stop(id)`：
   - 更新 `status` 为 `paused`。
   - 如果有内存中的 AbortController（通过全局 Map `activeSubagentControllers`），调用 `abort()`。
   - 返回 `OperationResult<SessionEntity>`。

3. 新增 `rerun(id)`：
   - 查询原 Subagent session，读取 `agentId`、`model`、`systemPrompt`、`taskDescription`、`parentSessionId`。
   - 创建新 `ChatSession`：
     ```ts
     title: `${original.title} (重跑)`,
     kind: "subagent",
     parentSessionId: original.parentSessionId,
     agentId: original.agentId,
     model: original.model,
     systemPrompt: original.systemPrompt,
     taskDescription: input.taskDescription ?? original.taskDescription,
     status: "running",
     ```
   - 立即启动 `runAgentLoopStream` 后台执行（复用 `chatAgentStream` 逻辑）。
   - 返回新 session id。

#### 全局 AbortController 管理（可选）

文件：`apps/server/src/infra/subagentRuntime.ts`（新建）

```ts
const activeSubagentControllers = new Map<string, AbortController>();

export function registerSubagentController(sessionId: string, controller: AbortController): void {
  activeSubagentControllers.set(sessionId, controller);
  controller.signal.addEventListener("abort", () => activeSubagentControllers.delete(sessionId));
}

export function abortSubagent(sessionId: string): boolean {
  const controller = activeSubagentControllers.get(sessionId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}
```

### 3.2 Router 层

文件：`apps/server/src/router.ts`

在 `sessionRouter` 中新增：

```ts
listChildren: publicProcedure
  .input(z.object({ parentSessionId: z.string().cuid(), pageSize: z.number().int().optional() }))
  .query(({ ctx, input }) =>
    ctx.services.session.list({
      page: 1,
      pageSize: input.pageSize ?? 20,
      parentSessionId: input.parentSessionId,
      kind: "subagent",
      orderBy: { updatedAt: "desc" },
    })
  ),

stop: publicProcedure
  .input(stopSessionSchema)
  .mutation(async ({ ctx, input }) => {
    const aborted = abortSubagent(input.id);
    return ctx.services.session.update({ id: input.id, status: "paused" });
  }),

rerun: publicProcedure
  .input(rerunSessionSchema)
  .mutation(({ ctx, input }) => ctx.services.session.rerun(input.id, input.taskDescription)),
```

### 3.3 Agent Stream 支持 Subagent 创建

文件：`apps/server/src/infra/agentStream.ts`

在 `chatAgentStream` 中：

1. 解析 `input.parentSessionId`。
2. 当 `input.parentSessionId` 存在或显式 `input.kind === "subagent"` 时：
   - 创建 `ChatSession` 时设置 `kind: "subagent"`、`parentSessionId`、`taskDescription: input.message`。
   - `status` 初始为 `running`。
3. 在流式运行前后维护 `status`：
   - 开始时 `update({ id: sessionId, status: "running" })`。
   - 正常结束 `update({ id: sessionId, status: "completed" })`。
   - 出错 `update({ id: sessionId, status: "failed" })`。
   - 被 abort 中断 `update({ id: sessionId, status: "paused" })`。
4. 注册 AbortController：
   ```ts
   if (isSubagent && signal) {
     registerSubagentController(sessionId, abortController);
   }
   ```

### 3.4 新增 `native:spawn_subagent` 工具（可选，为自动创建预留）

文件：`apps/server/src/infra/agentRuntime.ts` 或 `nativeTools.ts`

```ts
{
  name: "spawn_subagent",
  description: "创建一个子代理会话，分配独立任务。返回子会话 id。",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "子代理任务描述" },
      agentId: { type: "string", description: "指定 Agent id，不传则使用当前 Agent" },
      model: { type: "string", description: "模型 id，不传则继承当前会话" },
    },
    required: ["task"],
  },
}
```

实现：
- 创建 `ChatSession(kind: "subagent", parentSessionId: ctx.sessionId, ...)`。
- 启动后台 Task 或立即流式运行。
- 返回 `{ subagentSessionId, status: "running" }`。

---

## 4. 前端实现

### 4.1 左侧 Panel 结构调整

文件：`apps/web/components/chat.tsx`

当前左侧 panel 结构：

```tsx
<aside className={cn("...", leftOpen ? "w-64" : "w-0")}>
  {/* Header + Search + Session List */}
</aside>
```

改为四层：

```tsx
<aside className={cn("...", leftOpen ? "w-64" : "w-0")}>
  <ChatLeftPanelHeader
    selectedAgent={selectedAgent}
    onAgentChange={selectAgent}
    skills={skillsQuery.data?.items ?? []}
    onSkillSelect={...}
  />
  <SubagentPanel
    parentSessionId={effectiveSessionId ?? undefined}
    onCreate={openCreateSubagentDialog}
  />
  <div className="flex w-64 items-center ...">...</div>
  <div className="w-64 border-b ...">...</div>
  <div className="w-64 flex-1 overflow-y-auto p-2">...</div>
</aside>
```

### 4.2 新建 `ChatLeftPanelHeader` 组件

文件：`apps/web/components/chatLeftPanelHeader.tsx`

内容：
- 当前 Agent 头像/名称（只读或下拉切换）。
- 快捷技能 pills（最多 3-4 个，点击触发 skill 选择）。
- “插件”入口按钮。

### 4.3 新建 `SubagentPanel` 组件

文件：`apps/web/components/subagentPanel.tsx`

状态：
- 查询 `trpc.session.listChildren.useQuery({ parentSessionId })`。
- 轮询间隔 3s（当存在 running subagent 时）。

结构：

```tsx
<div className="w-64 shrink-0 border-b border-[var(--kp-divider)] p-2">
  <div className="mb-2 flex items-center justify-between">
    <span className="text-xs font-medium text-[var(--kp-text-2)]">Subagents</span>
    <button onClick={onCreate} className="...">+ 新建</button>
  </div>
  <div className="space-y-2">
    {subagents.map((s) => (
      <SubagentCard key={s.id} subagent={s} onRefresh={refetch} />
    ))}
    {subagents.length === 0 && (
      <p className="text-[10px] text-[var(--kp-text-3)]">暂无子代理</p>
    )}
  </div>
</div>
```

### 4.4 新建 `SubagentCard` 组件（Kimi Code 风格）

文件：`apps/web/components/subagentCard.tsx`

```tsx
export function SubagentCard({ subagent, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const statusColor = {
    running: "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    paused: "bg-gray-400",
    failed: "bg-red-500",
    active: "bg-green-500",
  }[subagent.status] ?? "bg-gray-400";

  return (
    <div className="rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-2 text-xs shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} />
        <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">
          {subagent.title}
        </span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-[var(--kp-divider-light)] pt-2">
          {subagent.taskDescription && (
            <p className="line-clamp-3 text-[11px] text-[var(--kp-text-3)]">
              {subagent.taskDescription}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            <Link href={`/chat?sessionId=${subagent.id}`} className="...">查看详情</Link>
            {subagent.status === "running" && (
              <button onClick={() => stop(s.id)} className="...">停止</button>
            )}
            <button onClick={() => rerun(s.id)} className="...">重跑</button>
            <button onClick={() => remove(s.id)} className="...">删除</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### 4.5 新建 Subagent 弹窗

复用 `ConfirmDialog`（`apps/web/components/shared.tsx`），表单字段：

- Agent 选择（`KpSelect`，默认当前 Agent）。
- 任务描述 textarea。
- 模型选择（可选，默认当前模型）。

提交逻辑：

```ts
const handleCreate = async () => {
  await streamAgentChat(
    {
      parentSessionId: effectiveSessionId,
      agentId: selectedAgentId,
      message: taskDescription,
      model: selectedModel,
    },
    {
      onDone: () => subagentsQuery.refetch(),
      onError: (msg) => setError(msg),
    },
    new AbortController().signal
  );
};
```

### 4.6 状态同步

- 创建 Subagent 后立即 `refetch` 列表。
- `SubagentPanel` 在检测到 running subagent 时开启 3s 轮询。
- 停止/删除/重跑后手动 `refetch`。

---

## 5. 后台管理页 `/subagents`

### 5.1 页面文件

文件：`apps/web/app/subagents/page.tsx`

布局：
- 页面标题：Subagent 管理。
- 表格列：标题、父 Session ID（点击跳转 `/chat?sessionId=...`）、Agent、状态、创建时间、更新时间、操作。
- 操作按钮：查看详情、停止、重跑、删除。
- 支持按状态过滤、按父 Session 搜索。

### 5.2 数据查询

```ts
const subagentsQuery = trpc.session.list.useQuery({
  page: 1,
  pageSize: 50,
  kind: "subagent",
});
```

### 5.3 路由入口

在 `/agents` 页面或顶部导航添加 `/subagents` 链接。

---

## 6. 与 AgentSwarm 的兼容

- Subagent 复用 `ChatSession`，后续 AgentSwarm 可新增 `Swarm` / `SwarmMember` 实体，而不破坏现有 Subagent 数据。
- `ChatSession.kind` 可扩展为 `"chat" | "subagent" | "swarm"`。
- `parentSessionId` 可直接迁移为 `swarmId` 或保留为层级关系。
- `native:spawn_subagent` 工具可扩展为 `native:spawn_swarm_member`。

---

## 7. 单元测试计划

### 7.1 后端单元测试

文件：`apps/server/src/__tests__/session-subagent.test.ts`（新建）

#### 7.1.1 模型创建

```ts
it("创建普通会话 kind 默认为 chat", async () => {
  const res = await trpcMutate("session.create", { title: "普通会话" });
  expect(res.data.kind).toBe("chat");
  expect(res.data.parentSessionId).toBeNull();
});

it("创建 Subagent 会话 kind 为 subagent 并记录 parentSessionId", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  const res = await trpcMutate("session.create", {
    title: "Subagent",
    parentSessionId: parent.data.id,
    kind: "subagent",
    taskDescription: "执行任务 A",
  });
  expect(res.data.kind).toBe("subagent");
  expect(res.data.parentSessionId).toBe(parent.data.id);
  expect(res.data.taskDescription).toBe("执行任务 A");
});
```

#### 7.1.2 列表过滤

```ts
it("list 可按 parentSessionId 过滤子代理", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  await trpcMutate("session.create", { title: "子1", parentSessionId: parent.data.id, kind: "subagent" });
  await trpcMutate("session.create", { title: "子2", parentSessionId: parent.data.id, kind: "subagent" });
  await trpcMutate("session.create", { title: "其他", kind: "chat" });

  const list = await trpcQuery("session.list", { parentSessionId: parent.data.id, kind: "subagent" });
  expect(list.items).toHaveLength(2);
  expect(list.items.every((s) => s.kind === "subagent")).toBe(true);
});

it("listChildren 返回父会话的所有 subagent", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  await trpcMutate("session.create", { title: "子", parentSessionId: parent.data.id, kind: "subagent" });

  const list = await trpcQuery("session.listChildren", { parentSessionId: parent.data.id });
  expect(list.items).toHaveLength(1);
});
```

#### 7.1.3 停止与重跑

```ts
it("stop 把 subagent 状态改为 paused", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  const sub = await trpcMutate("session.create", { title: "子", parentSessionId: parent.data.id, kind: "subagent", status: "running" });
  const stopped = await trpcMutate("session.stop", { id: sub.data.id });
  expect(stopped.data.status).toBe("paused");
});

it("rerun 基于原 subagent 创建新 subagent", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  const sub = await trpcMutate("session.create", {
    title: "子",
    parentSessionId: parent.data.id,
    kind: "subagent",
    taskDescription: "任务 A",
    agentId: "some-agent-id",
    model: "deepseek-v4-pro",
  });
  const rerun = await trpcMutate("session.rerun", { id: sub.data.id });
  expect(rerun.data.id).not.toBe(sub.data.id);
  expect(rerun.data.kind).toBe("subagent");
  expect(rerun.data.parentSessionId).toBe(parent.data.id);
  expect(rerun.data.taskDescription).toBe("任务 A");
});
```

#### 7.1.4 ChatStream 创建 Subagent

```ts
it("chat stream 带 parentSessionId 创建 kind=subagent 的 session", async () => {
  const parent = await trpcMutate("session.create", { title: "父会话" });
  // 模拟 POST /api/agent/chat/stream
  const res = await fetch(`${SERVER_URL}/api/agent/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentSessionId: parent.data.id, message: "搜索 KnowPilot", agentId: defaultAgentId }),
  });
  expect(res.ok).toBe(true);
  // 验证子会话存在
  const list = await trpcQuery("session.listChildren", { parentSessionId: parent.data.id });
  expect(list.items.length).toBeGreaterThan(0);
  expect(list.items[0].kind).toBe("subagent");
});
```

### 7.2 共享 Schema 测试

文件：`packages/shared/src/__tests__/schemas.test.ts`（已存在则追加）

```ts
it("createSessionSchema 接受 subagent 字段", () => {
  const input = {
    title: "子代理",
    parentSessionId: "cmr123",
    kind: "subagent",
    taskDescription: "任务",
  };
  expect(() => createSessionSchema.parse(input)).not.toThrow();
});

it("listSessionsSchema 接受 kind/status 过滤", () => {
  expect(() => listSessionsSchema.parse({ kind: "subagent", status: "running" })).not.toThrow();
});
```

### 7.3 前端组件测试

文件：`apps/web/components/__tests__/subagentCard.test.tsx`（新建，可选）

```ts
it("渲染 subagent 状态圆点和标题", () => {
  render(<SubagentCard subagent={mockSubagent} onRefresh={() => {}} />);
  expect(screen.getByText("搜索助手")).toBeInTheDocument();
});

it("点击展开显示操作按钮", async () => {
  render(<SubagentCard subagent={mockSubagent} onRefresh={() => {}} />);
  await userEvent.click(screen.getByRole("button"));
  expect(screen.getByText("查看详情")).toBeInTheDocument();
  expect(screen.getByText("重跑")).toBeInTheDocument();
});
```

### 7.4 Playwright E2E 测试（mock 模式）

文件：`apps/web/e2e/subagent-mock.spec.ts`（新建，依赖 mock chat 稳定后）

```ts
test("手动创建 subagent 后左侧出现卡片", async ({ page }) => {
  await waitForChatReady(page);
  await page.getByText("+ 新建").click();
  await page.getByPlaceholder("任务描述").fill("总结本地文章");
  await page.getByText("创建").click();
  await expect(page.getByTestId("subagent-card")).toHaveCount(1);
});

test("subagent 卡片可展开并跳转详情", async ({ page }) => {
  // ... 创建 subagent
  await page.getByTestId("subagent-card").click();
  await page.getByText("查看详情").click();
  await expect(page).toHaveURL(/sessionId=/);
});
```

---

## 8. 实施顺序

建议按以下顺序执行：

1. **Schema & 共享类型**（prisma + shared schemas）。
2. **迁移数据库**（`pnpm db:push`、`pnpm db:generate`）。
3. **后端 Service & Router**（listChildren、stop、rerun、session.create 扩展）。
4. **后端单元测试**（先红后绿）。
5. **Agent Stream 支持 Subagent 创建**。
6. **前端左侧 panel 组件**（ChatLeftPanelHeader、SubagentPanel、SubagentCard）。
7. **前端新建 Subagent 弹窗**。
8. **后台管理页 `/subagents`**。
9. **Playwright E2E**。
10. **文档更新**：更新 `AGENTS.md` 或 `docs/development/README.md` 说明 Subagent 使用方式。

---

## 10. UI/UX 设计

### 10.1 设计原则

- **减少认知负担**：Subagent 是“会话里的子任务”，用户应一眼看出它和主会话的关系。
- **即时反馈**：创建、停止、重跑后立即看到状态变化，避免“点了没反应”。
- **Kimi Code 风格**：可折叠卡片、左侧状态圆点、工具图标、运行详情展开。
- **不打断主流程**：Subagent 在后台运行，用户可以继续和主 Agent 对话。

### 10.2 左侧 Panel 布局

```
┌────────────────────────────────────┐  w-64
│  🤖 assistant · deepseek-v4-flash  │  ← 当前 Agent + 模型，可点击切换
│  ───────────────────────────────── │
│  [技能] [插件] [定时任务]          │  ← 快捷入口 pills（最多一行，溢出横向滚动）
├────────────────────────────────────┤
│  Subagents                    [+]  │  ← 标题 + 新建按钮
│  ● 搜索助手                ▶       │  ← 可折叠卡片
│  ● 写作助手                ▶       │
│  ○ 数据分析师（已暂停）    ▶       │
├────────────────────────────────────┤
│  对话历史                   ➕      │  ← 原 header
│  [搜索会话…]                       │
├────────────────────────────────────┤
│  今天                              │
│  - 你好                            │
│  昨天                              │
│  - 总结文章...                     │
└────────────────────────────────────┘
```

#### 10.2.1 当前 Agent 区

- 显示当前 Agent 名称和模型，如 `assistant · deepseek-v4-flash`。
- 点击后弹出 Agent 选择下拉（复用现有 `KpSelect`），切换后主 Agent 立即生效。
- 如果是 subagent 会话（当前会话 `kind === "subagent"`），显示返回父会话按钮。

#### 10.2.2 快捷入口区

- 技能/插件/定时任务以 pill 形式展示。
- 最多显示 3 个，超出时显示 `+n` 更多按钮。
- 点击 pill 直接填充输入框或触发 skill 选择。

#### 10.2.3 Subagent 列表区

- 标题固定为 `Subagents`，右侧 `+ 新建` 按钮。
- 列表最多显示 5 个，超出滚动。
- 每个卡片默认折叠，只显示状态圆点 + 图标 + 标题 + 展开箭头。

### 10.3 Subagent 卡片状态设计

| 状态 | 圆点 | 标题后缀 | 可操作 |
|---|---|---|---|
| running | 蓝色脉冲 | （无） | 停止、查看详情 |
| completed | 绿色 | （无） | 查看详情、重跑、删除 |
| paused | 灰色 | 已暂停 | 重跑、删除、查看详情 |
| failed | 红色 | 失败 | 重跑、删除、查看详情 |
| active | 绿色 | （无） | 查看详情、删除 |

卡片 hover 时显示操作按钮（停止/重跑/删除），避免默认拥挤。

### 10.4 创建 Subagent 弹窗

触发：点击左侧 `+ 新建` 或输入框上方的 `Agent 集群` 快捷入口。

弹窗内容：

```
┌────────────────────────────┐
│  新建 Subagent              │
├────────────────────────────┤
│  Agent                      │
│  [assistant ▼]              │
│                             │
│  任务描述                   │
│  ┌────────────────────┐    │
│  │ 请总结本地文章...   │    │
│  └────────────────────┘    │
│                             │
│  模型（可选）                │
│  [deepseek-v4-flash ▼]     │
│                             │
│  [取消]      [创建并运行]   │
└────────────────────────────┘
```

UX 细节：
- 任务描述 placeholder：`“例如：搜索 KnowPilot 并整理成 200 字摘要”`。
- 创建后立即在左侧出现卡片，状态为 `running`，无需等待完成。
- 如果创建失败，卡片不出现，改为 toast / 错误提示。

### 10.5 主对话区 Subagent 提示

当当前会话是某个父会话的 Subagent 时：
- 顶部标题显示 `Subagent · 任务标题`。
- 增加一行小字：`来自会话 #父会话标题`，点击可跳转回父会话。
- 输入框默认禁用，或提示“这是 Subagent 任务会话”。

### 10.6 运行状态同步

- Subagent 运行中卡片每 3s 轮询一次状态。
- 完成时圆点变绿，若用户展开了卡片，自动滚动到最新输出（可选）。
- 失败时圆点变红，卡片自动展开并显示错误原因。

### 10.7 空态

当没有 Subagent 时：

```
┌────────────────────────────┐
│  Subagents            [+]  │
├────────────────────────────┤
│  🤖                        │
│  暂无子代理                 │
│  点击 + 创建第一个任务      │
└────────────────────────────┘
```

### 10.8 错误与边界

- 创建失败：弹窗内显示红色错误文本，不关闭弹窗。
- 停止失败：toast 提示“停止失败，请重试”。
- 删除确认：使用 `ConfirmDialog`，提示“删除后无法恢复”。
- 重跑失败：保留原 Subagent，新建失败时 toast 提示。

### 10.9 动效

- 卡片展开/折叠：高度过渡 200ms，箭头旋转。
- 新卡片出现：从上方滑入 + 淡入。
- 状态变化：圆点颜色过渡 200ms，running 时脉冲动画。
- 左侧 panel 折叠/展开：保持现有 300ms 宽度过渡。

### 10.10 响应式

- 桌面：左侧 panel 默认展开（w-64）。
- 平板/小屏：左侧 panel 默认折叠，通过顶部按钮打开，作为 overlay。
- Subagent 卡片在窄屏下操作按钮换行显示。

### 10.11 键盘与可访问性

- 新建按钮支持 `Ctrl+Shift+S` 快捷键（可选）。
- 卡片头部是 `button`，支持 Enter/Space 展开。
- 操作按钮有明确 `aria-label`，如 `aria-label="停止子代理 搜索助手"`。
- 状态圆点对色盲用户增加 `title` 属性：`title="运行中"`。

### 10.12 与现有 Chat 风格统一

- 颜色变量使用项目已有的 `--kp-bg`、`--kp-bg-alt`、`--kp-divider`、`--kp-brand`、`--kp-text-*`。
- 圆角使用现有 `rounded-lg`、`rounded-xl`。
- 字体大小与现有 session list 一致（text-xs / text-[11px]）。

---

## 11. 备注

- 本计划假设使用单文件收拢约定：所有 backend service 继续放在 `apps/server/src/services.ts`，所有 router 继续放在 `apps/server/src/router.ts`。
- 前端通用组件继续放在 `apps/web/components/shared.tsx`，新增业务组件放在 `apps/web/components/`。
- 如需 Agent 自动创建 Subagent，在步骤 3-5 完成后追加 `native:spawn_subagent` 工具实现。
- UI/UX 设计应随着开发逐步验证，优先实现核心流程，再打磨动效和空态。
