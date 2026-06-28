# L4：自动化与工作流

> 目标：让 Agent 不仅能被手动调用，还能被事件触发、多 Agent 协作，并在关键操作上请求人类审批。

---

## 模块清单

| 模块 | 实体 | 状态 |
|---|---|---|
| L4-M01 触发器 | `Trigger` | [已完成] CRUD + UI + TriggerEngine + Task 执行链 |
| L4-M02 审批系统 | `Approval` | [已完成] CRUD + ApprovalGate + `/approvals` |
| L4-M03 Agent 工作流 | 运行时 | [已完成] `agent.runWorkflow` + humanApproval 暂停 |
| L4-M04 工具权限矩阵 | 运行时 | [已完成] delete/git.push 等 ApprovalGate |

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

1. [已完成] 事件总线：`BaseService` 在 create/update/delete 后通过 `AppEventBus` 发布 `{entity}.{action}` 事件。
2. [已完成] `TriggerEngine`（`infra/triggerEngine.ts`）监听 `*` 事件，匹配数据库中启用的 Trigger 规则。
3. [已完成] 匹配后调用 Skill / Task / Agent（TriggerEngine + TaskRunner）。
4. [已完成] Trigger / Approval 前端管理页（`/triggers`、`/approvals`、`/prompts`）。

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

默认需要审批的操作（**规划，代码未接入**）：

| operation | 是否需要审批 |
|---|---|
| agent.delete | 建议 |
| skill.delete | 建议 |
| mcp.create / update / delete | 建议 |
| task.delete | 建议 |
| git.push | 建议 |
| file.delete | 建议 |
| post.delete | 建议 |
| post.update (published) | 可配置 |

---

## L4 验收标准

- [x] 可以创建/启用/禁用 Trigger（后端 CRUD + `/triggers` UI）。
- [x] 文章发布等事件能触发 Skill / Task（TriggerEngine + TaskRunner db:sync）。
- [x] 危险操作自动进入 Approval 待审批状态（ApprovalGate）。
- [x] 用户可以在 UI 中查看并通过/拒绝审批（`/approvals`）。
- [x] 可以定义并运行简单的多步骤 Agent 工作流（`agent.runWorkflow`）。
