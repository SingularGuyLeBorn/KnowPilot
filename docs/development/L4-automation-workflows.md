# L4：自动化与工作流

> 目标：让 Agent 不仅能被手动调用，还能被事件触发、多 Agent 协作，并在关键操作上请求人类审批。

---

## 模块清单

| 模块 | 实体 | 状态 |
|---|---|---|
| L4-M01 触发器 | `Trigger` | [待开始] 后端 Router 已存在，缺引擎和 UI |
| L4-M02 审批系统 | `Approval` | [待开始] 同上 |
| L4-M03 Agent 工作流 | 运行时 | [待开始] 需设计工作流引擎 |
| L4-M04 工具权限矩阵 | 运行时 | [待开始] 需定义哪些工具需要审批 |

---

## L4-M01 触发器

### 数据模型 `Trigger`

```ts
{
  id: cuid,
  name: "文章发布后同步",
  type: "event" | "schedule" | "webhook",
  source: "post.published",
  actionType: "skill" | "mcp" | "task",
  actionId: "notify-discord",
  enabled: true,
}
```

### API

标准 CRUD + list。

### 运行方式

1. 事件总线：在 `post.create` / `post.update` 等 mutation 成功后发布事件。
2. Trigger 引擎监听事件，匹配 `source` 和 `type`。
3. 调用对应的 Skill / MCP / Task。

---

## L4-M02 审批系统

### 数据模型 `Approval`

```ts
{
  id: cuid,
  toolName: "agent.delete",
  args: { id: "..." },
  status: "pending" | "approved" | "rejected",
  createdAt: Date,
  updatedAt: Date,
}
```

### API

- `approval.create`
- `approval.list`（按 status 过滤）
- `approval.getById`
- `approval.update`（仅允许修改 status）
- `approval.delete`

### 使用方式

危险 procedure 内部：

```ts
if (toolRequiresApproval("agent.delete")) {
  const approval = await createApproval("agent.delete", input);
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "删除 Agent 需要用户确认",
    cause: { reason: "PENDING_APPROVAL", approvalId: approval.id },
  });
}
```

前端收到后弹出审批卡片，用户确认后调用 `approval.update` 放行。

---

## L4-M03 Agent 工作流

### 概念

工作流是一系列步骤，每个步骤可以是：

- 调用 Skill
- 调用 MCP Tool
- 读取 Memory / Post
- 人类审批
- 条件分支

### 存储

可以先以 JSON 文件形式存在 `content/workflows/`（L4 扩展），数据库缓存。

### 运行示例

```yaml
name: 发布文章助手
steps:
  - action: readPost
    input: { slug: "{{slug}}" }
  - action: skill:polish
    input: { content: "{{steps.0.content}}" }
  - action: humanApproval
    input: { title: "确认发布润色后的文章？" }
  - action: post.update
    input: { id: "{{post.id}}", content: "{{steps.1.output}}", published: true }
```

---

## L4-M04 工具权限矩阵

默认需要审批的操作：

| operation | 是否需要审批 |
|---|---|
| agent.delete | [已完成] |
| skill.delete | [已完成] |
| mcp.create / update / delete | [已完成] |
| task.delete | [已完成] |
| git.push | [已完成] |
| file.delete | [已完成] |
| post.delete | 建议 [已完成] |
| post.update (published) | 可配置 |

---

## L4 验收标准

- [ ] 可以创建/启用/禁用 Trigger。
- [ ] 文章发布等事件能触发 Skill / Task。
- [ ] 危险操作自动进入 Approval 待审批状态。
- [ ] 用户可以在 UI 中查看并通过/拒绝审批。
- [ ] 可以定义并运行简单的多步骤 Agent 工作流。
