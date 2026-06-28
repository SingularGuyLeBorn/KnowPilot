# 错误处理规范

> 目标：让 AI 能根据错误信息自我修复，也让人类一眼看懂问题。

---

## 1. 禁止的行为

[未实现] 不要这样：

```ts
throw new Error("Something went wrong");
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
return { success: false };
```

这些对 AI 和人类都没用。

---

## 2. 推荐的错误结构

所有后端错误都抛出 `TRPCError`，并携带额外 `cause` 信息：

```ts
throw new TRPCError({
  code: "BAD_REQUEST",           // TRPC 标准错误码
  message: "创建 Agent 失败：名称 'coder' 已被占用",
  cause: {
    entity: "agent",
    operation: "create",
    field: "name",
    value: "coder",
    reason: "DUPLICATE_NAME",
    suggestion: "请换一个唯一名称，或使用 update 接口更新已有 Agent",
  },
});
```

前端 / AI 收到的错误 JSON 形如：

```json
{
  "json": {
    "message": "创建 Agent 失败：名称 'coder' 已被占用",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "path": "agent.create",
      "cause": {
        "entity": "agent",
        "operation": "create",
        "field": "name",
        "value": "coder",
        "reason": "DUPLICATE_NAME",
        "suggestion": "请换一个唯一名称，或使用 update 接口更新已有 Agent"
      }
    }
  }
}
```

---

## 3. 错误码使用指南

| 场景 | TRPC code | cause.reason |
|---|---|---|
| 输入参数校验失败 | `BAD_REQUEST` | `VALIDATION_ERROR` / `MISSING_FIELD` |
| 唯一字段重复 | `CONFLICT` | `DUPLICATE_NAME` / `DUPLICATE_PATH` |
| 记录不存在 | `NOT_FOUND` | `RECORD_NOT_FOUND` |
| 外键/关联记录不存在 | `BAD_REQUEST` | `RELATED_RECORD_MISSING` |
| 数据库唯一约束失败 | `CONFLICT` | `UNIQUE_CONSTRAINT_VIOLATION` |
| 外部命令执行失败（Git/MCP） | `INTERNAL_SERVER_ERROR` | `COMMAND_FAILED` |
| 权限不足（L5） | `FORBIDDEN` | `UNAUTHORIZED` |
| 频率限制（L5） | `TOO_MANY_REQUESTS` | `RATE_LIMITED` |

---

## 4. 校验错误的字段级提示

Zod 校验失败时，把具体字段和期望类型暴露出来：

```ts
import { TRPCError } from "@trpc/server";

try {
  inputSchema.parse(input);
} catch (err) {
  if (err instanceof z.ZodError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `参数校验失败：${err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("；")}`,
      cause: {
        reason: "VALIDATION_ERROR",
        issues: err.errors,
      },
    });
  }
}
```

---

## 5. 数据库错误包装

不要把原始 Prisma / SQLite 错误直接抛给前端：

```ts
try {
  await ctx.prisma.agent.create({ data: input });
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `创建 Agent 失败：名称 '${input.name}' 已存在`,
      cause: { reason: "DUPLICATE_NAME", field: "name", value: input.name },
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `创建 Agent 时数据库发生未知错误`,
    cause: { reason: "DATABASE_ERROR", originalError: String(err) },
  });
}
```

---

## 6. AI 可读的补充字段

为了让 LLM Agent 能自动重试或提示用户，每个错误 cause 里尽量包含：

- `entity`: 发生错误的实体名
- `operation`: `create` / `update` / `delete` / `list`
- `field`: 具体字段（可选）
- `value`: 出错的字段值（可选）
- `reason`: 机器可读的错误原因标识
- `suggestion`: 给 AI / 人类的修复建议

---

## 7. 日志记录

所有非预期错误都应写入 `Log` 表，方便排查：

```ts
await ctx.prisma.log.create({
  data: {
    level: "error",
    component: "agent.router",
    event: "create.failed",
    message: err.message,
    metadata: { input, cause: err.cause },
  },
});
```

预期错误（如重复名称）不需要记 error 日志，但可以记 info/debug。
