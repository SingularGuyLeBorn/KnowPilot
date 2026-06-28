# AI 可调用 API 设计

> 让 Agent 不需要写死业务逻辑，就能「发现、调用、纠错」后端能力。

---

## 1. 设计目标

- **可发现**：Agent 能拿到每个 procedure 的 human-readable 描述和输入 JSON Schema。
- **可调用**：Agent 能直接通过 tRPC 调用，返回结构化数据。
- **可纠错**：调用失败时，错误信息足够让 Agent 调整参数重试或向用户求助。
- **可审计**：Agent 的每次调用最终落到 `Log` / `Approval` 表，可追溯。

---

## 2. 给每个 Router 加 `describe` 元数据

每个 procedure 在定义时附上 `meta.description`：

```ts
export const agentRouter = router({
  create: publicProcedure
    .meta({
      description: "创建一个新的 AI Agent。name 必须唯一。",
      aiReadable: true,
    })
    .input(createAgentSchema)
    .mutation(async ({ ctx, input }) => { ... }),

  list: publicProcedure
    .meta({
      description: "列出所有 Agent，支持分页和关键词搜索。",
      aiReadable: true,
    })
    .input(listAgentsSchema)
    .query(async ({ ctx, input }) => { ... }),
});
```

后续可以通过 tRPC 的 `appRouter._def.procedures` 自动生成 tool schema 给 OpenAI / Claude。

---

## 3. 提供一个统一的 `ai.tools` 接口

在 L2 阶段新增一个 `ai` router，暴露所有 AI 可调用的工具描述：

```ts
ai.tools.query(() => {
  return [
    {
      name: "post.list",
      description: "列出已发布的文章",
      parameters: zodToJsonSchema(listPostsSchema),
    },
    {
      name: "agent.create",
      description: "创建一个新的 AI Agent",
      parameters: zodToJsonSchema(createAgentSchema),
    },
    // ...
  ];
});
```

前端/Agent 先调用 `ai.tools` 拿到工具列表，再按需调用具体 procedure。

---

## 4. 调用路径

```textnAgent (LLM)
   │
   ├─ 1. ai.tools ──→ 获取可用工具 + JSON Schema
   │
   ├─ 2. 生成工具调用参数
   │
   ├─ 3. post.list / agent.create / ... ──→ tRPC procedure
   │
   └─ 4. 根据返回结果继续推理或向用户展示
```

---

## 5. 错误自愈策略

Agent 收到错误后，可以按 reason 自动处理：

| reason | Agent 行为 |
|---|---|
| `VALIDATION_ERROR` | 根据 issues 修正参数后重试 |
| `DUPLICATE_NAME` | 询问用户是否覆盖，或自动加后缀重试 |
| `RECORD_NOT_FOUND` | 调用 `list` 确认 ID，或提示用户 |
| `RELATED_RECORD_MISSING` | 先创建关联记录，再重试原操作 |
| `DATABASE_ERROR` | 停止重试，向用户报告 |

---

## 6. 权限与审批（L4）

危险操作需要用户审批：

- `agent.delete`
- `task.delete`
- `mcp.create` / `mcp.update`
- `git.pull` / `git.push`
- `file.delete`

这些 procedure 内部检查 `Approval` 表：

```ts
// 伪代码
if (requiresApproval("agent.delete", input)) {
  const approval = await ctx.prisma.approval.create({
    data: { toolName: "agent.delete", args: input, status: "pending" },
  });
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "删除 Agent 需要用户确认",
    cause: { reason: "PENDING_APPROVAL", approvalId: approval.id },
  });
}
```

---

## 7. 调用日志

每个 AI 调用都记录到 `Log`：

```ts
{
  level: "info",
  component: "ai.call",
  event: "agent.create",
  message: "AI 调用 agent.create 成功",
  metadata: { input, outputId: agent.id, durationMs },
}
```

这是 Agent 自我复盘和任务追踪的数据基础。
