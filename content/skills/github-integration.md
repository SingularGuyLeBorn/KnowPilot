---
name: github-integration
description: >-
  GitHub 完整集成工作流：仓库/文件/Issue/PR/分支/Workflow 的增删改查与合并。
  用户提到 GitHub、开 PR、提 Issue、改远程文件时启用。需 GITHUB_TOKEN。
icon: Github
trigger: /github
enabled: true
kind: skill
version: "1.0.0"
allowed-tools:
  - native:github_search_repos
  - native:github_get_repo
  - native:github_create_repo
  - native:github_update_repo
  - native:github_delete_repo
  - native:github_get_file
  - native:github_create_file
  - native:github_update_file
  - native:github_delete_file
  - native:github_list_issues
  - native:github_get_issue
  - native:github_create_issue
  - native:github_update_issue
  - native:github_create_issue_comment
  - native:github_list_pull_requests
  - native:github_get_pull_request
  - native:github_create_pull_request
  - native:github_update_pull_request
  - native:github_merge_pull_request
  - native:github_list_branches
  - native:github_get_branch
  - native:github_create_branch
  - native:github_delete_branch
  - native:github_list_workflows
  - native:github_trigger_workflow
---

# GitHub 集成 Skill

严格用下方 `native:github_*` 工具。凭证：`GITHUB_TOKEN`（或 Credential 表）。仓库参数一般为 `owner/repo` 或工具要求的 `owner`+`repo`。

完成后回报可点击链接（`https://github.com/{owner}/{repo}/...`）。

## 0. 前置

- 无 token 时工具会失败：提示配置 `GITHUB_TOKEN`
- 破坏性操作（删仓/删文件/删分支/合 PR）可能走审批（`AGENT_DESTRUCTIVE_APPROVAL`）

## 1. 仓库

| 动作 | 工具 |
|------|------|
| 搜 | `github_search_repos` |
| 读 | `github_get_repo` |
| 建 | `github_create_repo` |
| 改 | `github_update_repo`（描述、可见性等） |
| 删 | `github_delete_repo`（破坏性，需确认） |

## 2. 文件（Contents API）

| 动作 | 工具 |
|------|------|
| 读 | `github_get_file`（path；可选 ref） |
| 建 | `github_create_file` |
| 改 | `github_update_file`（通常需 sha） |
| 删 | `github_delete_file`（破坏性） |

流程：先 `get_file` 取 sha → `update_file`；新建路径用 `create_file`。

## 3. Issue

| 动作 | 工具 |
|------|------|
| 列/读 | `github_list_issues` / `github_get_issue` |
| 建 | `github_create_issue` |
| 改 | `github_update_issue`（关 issue：`state=closed`） |
| 评论 | `github_create_issue_comment` |

## 4. Pull Request

| 动作 | 工具 |
|------|------|
| 列/读 | `github_list_pull_requests` / `github_get_pull_request` |
| 建 | `github_create_pull_request`（head/base/title/body） |
| 改 | `github_update_pull_request`（关 PR：`state=closed`） |
| 合 | `github_merge_pull_request`（破坏性，需确认） |

**常见开 PR 流程**：`create_branch` → 改文件（create/update_file 到该分支）→ `create_pull_request` → 把 PR URL 给用户。

## 5. 分支

| 动作 | 工具 |
|------|------|
| 列/读 | `github_list_branches` / `github_get_branch` |
| 建 | `github_create_branch`（通常基于某 sha 或默认分支） |
| 删 | `github_delete_branch`（破坏性） |

## 6. Actions Workflow

| 动作 | 工具 |
|------|------|
| 列 | `github_list_workflows` |
| 触发 | `github_trigger_workflow`（workflow_id + ref；按需 inputs） |

## 约束

- 删除仓库/分支、合并 PR 前必须向用户确认
- 不要编造 issue/PR 编号；以工具返回为准
- 权限不足（404/403）时说明 token scope 或仓库权限问题
- 优先交付 GitHub 网页链接
