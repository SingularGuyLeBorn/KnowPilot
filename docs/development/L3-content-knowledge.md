# L3：内容与知识运维

> 目标：管理文件、Git 仓库、后台任务、系统日志、工作区，让 KnowPilot 成为可持续运营的创作环境。

---

## 模块清单

| 模块 | 实体 | 内容目录 | 状态 |
|---|---|---|---|
| L3-M01 文件管理 | `File` | 磁盘 + DB 元数据 | [待开始] 后端 Router 已存在，缺 UI 和上传实现 |
| L3-M02 Git 仓库管理 | `GitRepo` | DB 元数据 + 磁盘仓库 | [待开始] 同上 |
| L3-M03 后台任务 | `Task` | `content/tasks/` | [待开始] 同上 |
| L3-M04 日志系统 | `Log` | DB 仅存储 | [待开始] 同上 |
| L3-M05 工作区 | `Workspace` | DB 仅存储 | [待开始] 同上 |

---

## L3-M01 文件管理

### 存储

- 元数据：SQLite `File` 表。
- 实际文件：`content/uploads/` 或 `public/uploads/`。

### API

标准 CRUD + list。`file.create` 接收文件元数据；上传本身可以走 tRPC + base64，或单独的 upload 路由。

### 安全

- 限制文件类型和大小。
- 禁止路径穿越（`../`）。

---

## L3-M02 Git 仓库管理

### 数据模型 `GitRepo`

```ts
{
  id: cuid,
  name: "KnowPilot",
  path: "D:/ALL IN AI/KnowPilot",
  branch: "main",
  remoteUrl?: "https://github.com/.../KnowPilot.git",
}
```

### API

标准 CRUD + list。额外提供：

| procedure | 说明 |
|---|---|
| `git.status` | 查询工作区状态 |
| `git.commit` | 提交更改 |
| `git.pull` | 拉取远程 |
| `git.push` | 推送到远程 |
| `git.log` | 获取提交历史 |

这些属于 L3 增强，可以在标准 CRUD 之后实现。

---

## L3-M03 后台任务

### 数据格式 `content/tasks/{name}.json`

```json
{
  "name": "daily-backup",
  "type": "scheduled",
  "status": "active",
  "cronExpression": "0 2 * * *",
  "input": { "target": "backup" }
}
```

### API

标准 CRUD + list，支持按 `status` 过滤。

### 运行方式

- 引入 `node-cron` 或 `bullmq`。
- 任务执行结果写回 `output` 字段和 `Log` 表。

---

## L3-M04 日志系统

### 数据模型 `Log`

```ts
{
  id: cuid,
  level: "debug" | "info" | "warn" | "error",
  component: "agent.router",
  event: "agent.create",
  message: "...",
  metadata?: object,
  createdAt: Date,
}
```

### API

- `log.create`
- `log.list`（支持按 level / component / keyword 过滤）
- `log.getById`
- `log.clearAll`

### 设计建议

日志应**不可修改、不可单个删除**（只提供 `clearAll` 或按时间范围清理）。

---

## L3-M05 工作区

### 数据模型 `Workspace`

```ts
{
  id: cuid,
  name: "默认工作区",
  description?: string,
  path: "D:/ALL IN AI/KnowPilot",
}
```

### API

标准 CRUD + list。

### 使用场景

多项目切换：一个 Workspace 对应一个本地路径，Agent 在该路径下执行文件/Git/MCP 操作。

---

## L3 验收标准

- [ ] 可以上传、查看、删除文件。
- [ ] 可以注册 Git 仓库并查看状态/提交历史。
- [ ] 可以创建/启停/删除定时任务。
- [ ] 可以按 level/component 过滤日志。
- [ ] 可以切换/管理工作区。
