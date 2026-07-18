---
name: yuque-integration
description: >-
  语雀完整集成工作流：Cookie 会话、知识库/文档 CRUD（Markdown 表格与公式）、
  目录，以及 Open API v2（YUQUE_TOKEN）仓库与文档。用户提到语雀/Yuque 时启用。
icon: BookOpen
trigger: /yuque
enabled: true
kind: skill
version: "1.0.0"
allowed-tools:
  - native:yuque_session_status
  - native:yuque_list_books
  - native:yuque_get_book_toc
  - native:yuque_get_doc
  - native:yuque_create_book
  - native:yuque_update_book
  - native:yuque_delete_book
  - native:yuque_create_doc
  - native:yuque_update_doc
  - native:yuque_delete_doc
  - native:yuque_list_repos
  - native:yuque_create_repo
  - native:yuque_update_repo
  - native:yuque_delete_repo
  - native:yuque_list_docs
  - native:yuque_create_doc_v2
  - native:yuque_update_doc_v2
  - native:yuque_delete_doc_v2
---

# 语雀集成 Skill

严格用下方 `native:yuque_*` 工具。日常默认走 **Web Cookie** 路径（`yuque_*` 无 `_v2` / 非 `*_repo`）；仅当用户有 `YUQUE_TOKEN`（个人令牌，不是网页 CSRF `_ctoken`）时用 Open API v2。

完成后回报链接：`https://www.yuque.com/{login}/{book_slug}/{doc_slug}`（缺 login 时给知识库链接或让用户从仪表盘打开）。

## 0. 会话

1. `yuque_session_status` — 失败则提示用户更新 `.env` 的 `YUQUE_SESSION` + `YUQUE_CTOKEN`（从浏览器 Cookie 复制）
2. `yuque_list_books` 可作连通性确认

## 1. 知识库（Web）

| 动作 | 工具 |
|------|------|
| 列 | `yuque_list_books` |
| 建 | `yuque_create_book`（name；可选 description / public / slug） |
| 改 | `yuque_update_book`（bookId + name/description/public） |
| 目录 | `yuque_get_book_toc` |
| 删 | `yuque_delete_book`（破坏性，不可恢复） |

`public`：0 私密 / 1 公开 / 2 空间成员（以 Web API 为准）。

## 2. 文档 CRUD（Web，含表格与公式）

| 动作 | 工具 |
|------|------|
| 建 | `yuque_create_doc`：`bookId` + `title` + `body`（Markdown） |
| 读 | `yuque_get_doc` |
| 改 | `yuque_update_doc`：`docId` + `bookId` + `title` + `body` |
| 删 | `yuque_delete_doc`（破坏性） |

**内容约定（直接写进 Markdown body）**：

```markdown
行内公式：$E=mc^2$

块级公式：

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

| 列A | 列B |
|---|---|
| $10^9$ | 备注 |
```

**推荐可见交付流程**：create_book → create_doc（带表格/公式）→ update_doc 追加段落 → 把文档 URL 给用户；仅用户明确要求时再 delete_doc / delete_book。

## 3. Open API v2（需 YUQUE_TOKEN）

| 动作 | 工具 |
|------|------|
| 列库 | `yuque_list_repos` |
| 建库 | `yuque_create_repo` |
| 改库 | `yuque_update_repo` |
| 删库 | `yuque_delete_repo` |
| 列文 | `yuque_list_docs`（namespace） |
| 建/改/删文 | `yuque_create_doc_v2` / `update_doc_v2` / `delete_doc_v2` |

无会员/无 `YUQUE_TOKEN` 时：**不要**强行走 v2；改用 Web Cookie 工具并说明原因。

## 约束

- Cookie 路径与 v2 路径不要混用同一操作的凭证假设
- 删除前向用户确认
- 工具失败原样回报；会话失效引导更新 Cookie
- 优先交付可打开链接
