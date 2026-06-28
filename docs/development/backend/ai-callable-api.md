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

[已完成] `ai` router 已在 `apps/server/src/router.ts` 实现：

```ts
ai.tools.query()   // 反射 meta.aiReadable !== false 的所有 procedure + JSON Schema
ai.invoke.mutation({ tool: "post.list", args: { page: 1, pageSize: 10 } })
```

前端通过 `useAIApi()`（`apps/web/lib/hooks.ts`）调用。Agent 运行时（`agentRuntime.ts`）已通过 native 工具 + `invokeTrpc` 与 LLM ReAct 循环串联；`ai.invoke` 供反射式工具发现场景使用。

---

## 4. 调用路径

```text
Agent (LLM)
   │
   ├─ 1. ai.tools ──→ 获取可用工具 + JSON Schema
   │
   ├─ 2. 生成工具调用参数
   │
   ├─ 3. ai.invoke / post.list / agent.create / ... ──→ tRPC procedure
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

[已完成] 危险操作通过 `ApprovalGate` 拦截（`REQUIRE_APPROVAL=true` 时生效）：

- `agent.delete`、`post.delete`、`skill.delete` 等实体 delete
- `git.push`
- 审批通过后 `approval.execute` / `approveAndExecute` 执行原操作

前端 `/approvals` 队列可查看与批准。

---

## 7. 调用日志

[已完成] 所有 mutation（含 `ai.invoke`）经 `loggerMiddleware` 写入 `Log` 表：

- `ai.invoke` 使用 `component: "ai.call"`，`metadata.tool` 记录工具名与耗时。
- 其他 mutation 按 router 名写入 `component` 字段。

```ts
{
  level: "info",
  component: "ai.call",
  event: "ai.invoke",
  message: "AI 调用 agent.create 成功 (42ms)",
  metadata: { tool: "agent.create", durationMs: 42, success: true },
}
```

这是 Agent 自我复盘和任务追踪的数据基础。
