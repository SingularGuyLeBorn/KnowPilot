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
  - native:feishu_append_doc_text
  - native:feishu_append_doc_blocks
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
| **写正文** | **`feishu_append_doc_text`** | **首选**：`documentId` + **Markdown**（服务端转原生标题/加粗/列表等） |
| 写结构块 | `feishu_append_doc_blocks` | 画板壳 / 复杂表格壳等（docx children） |
| 读 | `feishu_get_doc` | `documentId` |
| 搜 | `feishu_search_docs` | `query` |
| 改标题/已有块 | `feishu_update_doc` | 仅 `title` 或带已有 `block_id` 的 batch_update；**禁止**用它新建内容 |
| 删 | `feishu_delete_doc` | 破坏性；可能走审批 |

**推荐流程（可见交付）**：

```text
create_doc → append_doc_text（正文）→ append_doc_blocks（board）→ list_doc_whiteboards → whiteboard_from_diagram
```

完成后把 `https://feishu.cn/docx/{document_id}` 给用户；仅在用户明确要求时再 delete。

## 2. 文档内容：文本 / 公式 / 表格 / 画板壳

- **长文/试卷**：只用 `feishu_append_doc_text`，传入 **标准 Markdown**（服务端转飞书原生块）。**禁止**指望飞书直接渲染 raw `#` / `**`。
- **Markdown 强制规范**（与 MetaBlog 一致）：
  - 段落顶格，行首不要空格
  - 标题：`# ` / `## `（`#` 后必须有空格）
  - 无序列表只用 `- `（禁止 `*` / `+` 作列表符）
  - 加粗：`**重点**`（星号紧贴文字，内侧无空格）
  - 分割线：单独一行 `---`
  - **表格必须用标准 GFM**（服务端会写成飞书原生表格，不是管道符文本）：
    ```markdown
    | 方法 | 压缩比 |
    | --- | --- |
    | MLA | $2 n_h d_h / d_c$ |
    ```
    - 第二行 `|---|` 分隔符强烈建议写上（缺了服务端会尽量补齐，但列数不一致时仍会失败）
    - 单表不超过 9 行 × 9 列（飞书 API 硬限）；更大对比请拆多表或改用电子表格
    - 单元格内公式用 `$...$`，会进原生 equation，不要手写 `| a | b |` 假装表格
  - 公式：行内 `$E=mc^2$`，块级 `$$...$$`；禁止把公式写成无 `$` 的纯文本凑合
  - **飞书公式（KaTeX）硬约束**——违者文档里显示「无效公式」：
    - `$...$` / `$$...$$` **内只写纯数学**；中文说明写在公式外（段落/括号文字）
    - 禁止 `\text{中文...}`、`\text{ (注释) }`；函数名用 `\mathrm{RoPE}` 或直接 `RoPE`
    - 禁止 Python 切片写法（如 `q_t[:, :d_R]`）；改写成 `q_t` 的前 `d_R` 维等文字说明
    - `\text{}` 内若必须带下标变量，用 `$\text{...}$` 嵌套或干脆拆出公式外
  - 代码块用 fenced \`\`\`，不用缩进代码块
- **结构化块**：`feishu_append_doc_blocks`，`children` 示例：

```json
[
  {
    "block_type": 2,
    "text": { "elements": [{ "text_run": { "content": "第一题" } }] }
  },
  { "block_type": 43, "board": {} }
]
```

常见 `block_type`：文本 `2`；表格壳 `31`；画板 `43` + `board: {}`。

公式可放在文本块 elements 里：

```json
[
  { "text_run": { "content": "公式：" } },
  { "equation": { "content": "E=mc^2" } }
]
```

`feishu_update_doc` 只用于改标题或已有块；新建内容走 append_*。

## 3. 电子表格

1. `feishu_create_spreadsheet` → 得 `spreadsheet_token`
2. `feishu_append_spreadsheet_values`：`range` 如 `{sheetId}!A1:D4`，`values` 为二维数组

## 4. 画板

1. `feishu_append_doc_blocks` 插入 `{ "block_type": 43, "board": {} }`
2. `feishu_list_doc_whiteboards` 取 `whiteboardId`
3. 流程图优先：`feishu_whiteboard_from_diagram`（`format`: mermaid / plantuml / svg，默认 overwrite）
4. 原生节点：`feishu_create_whiteboard_nodes`；主题：`feishu_get/update_whiteboard_theme`
5. 清理节点：`feishu_delete_whiteboard_nodes`（破坏性）

## 5. 知识库（Wiki）

1. 已知真实 `spaceId`（**禁止**传 `"0"`）或先让用户提供；列节点：`feishu_get_wiki_nodes`
2. 建节点：`feishu_create_wiki_node`（默认 `objType=docx`）→ 用返回的 **`obj_token` 当 `documentId`**
3. 立刻 `feishu_append_doc_text` 写正文（不要对空文档狂调 `feishu_update_doc`）
4. 空间信息：`feishu_get_wiki_space`
5. Wiki 节点删除无专用工具：可对挂载的 docx `obj_token` 调 `feishu_delete_doc`（进回收站）

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

**1063003 Invalid operation 常见原因**（lookup 成功仍加失败时按此排查，勿谎称已移交）：
1. 目标手机号/邮箱就是**当前授权账号（文档所有者）**——飞书禁止给所有者再加协作者；所有者已有完整权限，直接给链接即可
2. 调用身份与目标**不同组织 / 不可互搜 / 已屏蔽**
3. 企业管控禁止此类授权
4. 用户说的「权限转移」若指**转移所有者**，当前工具集只有「加协作者」，没有 transfer owner；需如实说明并给可编辑链接或让用户在飞书客户端移交

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
