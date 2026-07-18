---
name: feishu-integration
description: >-
  飞书完整集成工作流：授权与 token、文档 CRUD、文档块内容（表格/公式）、电子表格、
  画板、知识库节点、协作者与发消息。用户提到飞书/Lark/云文档/Wiki/画板时启用。
icon: FileText
trigger: /feishu
enabled: true
kind: skill
version: "1.0.0"
allowed-tools:
  - native:feishu_token_status
  - native:feishu_refresh_token
  - native:feishu_authorize
  - native:feishu_get_doc
  - native:feishu_create_doc
  - native:feishu_update_doc
  - native:feishu_delete_doc
  - native:feishu_search_docs
  - native:feishu_list_permission_members
  - native:feishu_add_permission_member
  - native:feishu_update_permission_member
  - native:feishu_remove_permission_member
  - native:feishu_get_permission_public
  - native:feishu_update_permission_public
  - native:feishu_lookup_user
  - native:feishu_add_collaborator_by_contact
  - native:feishu_get_wiki_space
  - native:feishu_get_wiki_nodes
  - native:feishu_create_wiki_node
  - native:feishu_create_spreadsheet
  - native:feishu_append_spreadsheet_values
  - native:feishu_list_doc_whiteboards
  - native:feishu_list_whiteboard_nodes
  - native:feishu_create_whiteboard_nodes
  - native:feishu_whiteboard_from_diagram
  - native:feishu_delete_whiteboard_nodes
  - native:feishu_get_whiteboard_theme
  - native:feishu_update_whiteboard_theme
  - native:feishu_send_text
  - native:feishu_send_message
---

# 飞书集成 Skill

严格用下方 `native:feishu_*` 工具完成任务；先查 token，再操作资源。完成后回报 **document_id / 链接**（`https://feishu.cn/docx/{document_id}` 或 `https://feishu.cn/wiki/{node_token}`）。

## 0. 授权

1. `feishu_token_status` — 无效则 `feishu_refresh_token`
2. refresh 仍失败 → `feishu_authorize`（打开浏览器，用户点同意）
3. 发消息需应用已开通「机器人」+ `im:message:send_as_bot`（或等价）权限并已发布

## 1. 文档 CRUD

| 动作 | 工具 | 要点 |
|------|------|------|
| 建 | `feishu_create_doc` | 必填 `title`；可选 `folderToken` |
| 读 | `feishu_get_doc` | `documentId` |
| 搜 | `feishu_search_docs` | `query` |
| 改标题/块 | `feishu_update_doc` | `title` 和/或 `blocks`（docx `batch_update` 的 requests） |
| 删 | `feishu_delete_doc` | 破坏性；可能走审批 |

**推荐流程（可见交付）**：create → 写入内容 → update 标题/追加 → 把链接给用户；仅在用户明确要求时再 delete。

## 2. 文档内容：公式 / 表格 / 文本

`feishu_update_doc` 的 `blocks` 为飞书 docx `batch_update` requests。新建块（表格、公式段、画板容器）通常在**创建文档后**用块 children 语义写入；若当前只能走 `update_doc`，优先：

- 改标题：只传 `title`
- 改已有块文本：`blocks` 里用对应 `block_id` 的 update 请求

插入复杂结构时按飞书块类型约定构造（常见）：

- 文本块 `block_type: 2`，`text.elements` 可含 `text_run` 与 `equation`（如 `E=mc^2`）
- 表格块 `block_type: 31`，`table.property.row_size` / `column_size`
- 画板块 `block_type: 43`，`board: {}`

公式示例（文本 elements）：

```json
[
  { "text_run": { "content": "公式：" } },
  { "equation": { "content": "E=mc^2" } }
]
```

## 3. 电子表格

1. `feishu_create_spreadsheet` → 得 `spreadsheet_token`
2. `feishu_append_spreadsheet_values`：`range` 如 `{sheetId}!A1:D4`，`values` 为二维数组

## 4. 画板

1. 文档内先有 board 块（见上）→ `feishu_list_doc_whiteboards` 取 `whiteboardId`
2. 流程图优先：`feishu_whiteboard_from_diagram`（`format`: mermaid / plantuml / svg，默认 overwrite）
3. 原生节点：`feishu_create_whiteboard_nodes`；主题：`feishu_get/update_whiteboard_theme`
4. 清理节点：`feishu_delete_whiteboard_nodes`（破坏性）

## 5. 知识库（Wiki）

1. 已知 `spaceId` 或先让用户提供；列节点：`feishu_get_wiki_nodes`
2. 建节点：`feishu_create_wiki_node`（默认 `objType=docx`）→ 用返回的 `obj_token` 当 documentId 写内容
3. 空间信息：`feishu_get_wiki_space`
4. Wiki 节点删除无专用工具：可对挂载的 docx `obj_token` 调 `feishu_delete_doc`（进回收站）

## 6. 协作者（加人 + 设角色）

创建文档后把别人加成协作者：

| 你有什么 | 怎么做 |
|----------|--------|
| **邮箱** | `feishu_add_collaborator_by_contact`（`email` + `perm`）或 `feishu_add_permission_member`（`memberType=email`） |
| **手机号** | `feishu_add_collaborator_by_contact`（`mobile` + `perm`）。需应用开通通讯录查 ID：`contact:user.id:readonly`（或 `contact:contact:readonly_as_app`）并发布 |
| **open_id / 群 chat_id** | `feishu_add_permission_member`（`memberType=openid` 或 `openchat`） |
| 先查 ID | `feishu_lookup_user`（`mobile` / `email` → open_id） |

权限角色 `perm`：`view`（可阅读）/ `edit`（可编辑）/ `full_access`（可管理）。

- 列：`feishu_list_permission_members`
- 改角色：`feishu_update_permission_member`
- 移除：`feishu_remove_permission_member`（破坏性，可能审批）

**推荐流程**：`feishu_create_doc` → `feishu_add_collaborator_by_contact`（手机号或邮箱，`perm=edit`）→ 把文档链接发给对方。

## 7. 文档可见性 /「权限设置」面板

对应飞书 UI「权限设置」。读写：

- 读：`feishu_get_permission_public`
- 改（增量）：`feishu_update_permission_public`

| UI 文案 | API 字段 | 常用取值 |
|---------|----------|----------|
| 允许内容被分享到组织外 | `external_access_entity` | `open` / `closed` |
| 链接分享 | `link_share_entity` | `closed`；组织内可读 `tenant_readable`；组织内可编辑 `tenant_editable`；互联网可读 `anyone_readable`（须 `external_access_entity=open`） |
| 谁可以查看、添加、移除协作者（组织维） | `share_entity` | `anyone` / `same_tenant` |
| 谁可以查看、添加、移除协作者（协作者维） | `manage_collaborator_entity` | `collaborator_can_view` / `collaborator_can_edit` / `collaborator_full_access` |
| 谁可以复制内容 | `copy_entity` | `anyone_can_view` / `anyone_can_edit` / `only_full_access` |
| 谁可以创建副本、打印和下载 | `security_entity` | 同上 |
| 谁可以评论 | `comment_entity` | `anyone_can_view` / `anyone_can_edit` |

示例——仅组织内链接可阅读、禁止外部分享：

```
feishu_update_permission_public({
  token, type: "docx",
  external_access_entity: "closed",
  link_share_entity: "tenant_readable",
  manage_collaborator_entity: "collaborator_can_edit",
  copy_entity: "anyone_can_view",
  security_entity: "anyone_can_view",
  comment_entity: "anyone_can_view"
})
```

说明：UI「启用加密链接」等部分企业项可能无开放 API，做不到时如实告知用户需在飞书客户端设置。

## 8. 发消息

- `feishu_send_text`：`receiveId` + `receiveIdType`（open_id/chat_id/user_id）+ `text`
- 富消息：`feishu_send_message`（`msgType` + `content`）

## 约束

- 不要伪造成功；工具报错把 code/msg 原样告诉用户并给出修复建议（授权/权限/发布版本）
- 删文档、删画板节点、移除协作者前向用户确认
- 优先交付可打开的链接，而不是只回 id
