# GitHub CLI / API 测试实验室

用 Python 快速验证 GitHub REST API 和 GitHub CLI (`gh`) 的各项能力,为 Agent 工具开发提供依据. 

## GitHub CLI vs GitHub API

| 维度 | GitHub CLI (`gh`) | GitHub REST API |
|---|---|---|
| **定位** | 面向用户的命令行工具 | 底层 HTTP 接口 |
| **认证** | `gh auth login`(OAuth / PAT) | `Authorization: Bearer TOKEN` |
| **交互性** | 高(交互式创建 PR、Issue 等) | 低(纯 HTTP) |
| **脚本友好** | 支持 `--json` 输出 | 原生 JSON |
| **本地 git 集成** | ✅ `gh pr checkout` 等 | ❌ 无 |
| **Agent 适用性** | 需 backend 调用 `child_process` | 前端/后端均可直接 fetch |

**本 Lab 的测试策略**：
- 用 Python `requests` 直接调用 GitHub REST API(最可靠、最可控)
- 在代码注释中标注等效的 `gh` CLI 命令作为参考
- Agent 工具最终采用 **REST API** 方式(前端可直接调用,无需 backend 安装 `gh`)

## 文件结构

```
github-api/
├── README.md                         # 本文件
├── requirements.txt                  # Python 依赖
├── github_client.py                  # GitHub API 客户端封装
└── 99_github_cli_showcase.ipynb      # 全流程验证 Notebook
```

## 快速开始

### 1. 安装依赖

```bash
cd project/experiments/github-api
pip install -r requirements.txt
```

### 2. 配置环境变量

在项目根目录 `.env` 文件中添加：

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

> **获取 Token**：https://github.com/settings/tokens  
> 推荐权限：`repo`(私有仓库)、`read:org`(组织信息)、`workflow`(Actions)

### 3. 安装 GitHub CLI(可选,仅用于本地 CLI 测试)

```bash
# Windows (winget)
winget install --id GitHub.cli

# macOS
brew install gh

# 登录
gh auth login
```

### 4. 启动 Jupyter

```bash
jupyter lab
```

运行 `99_github_cli_showcase.ipynb` 验证全部能力. 

## 关键发现(待验证)

| 能力 | API 端点 | gh CLI 等效命令 | 状态 |
|---|---|---|---|
| 获取仓库信息 | `GET /repos/{owner}/{repo}` | `gh repo view owner/repo --json ...` | 待验证 |
| 列出仓库内容 | `GET /repos/{owner}/{repo}/contents/{path}` | `gh api repos/owner/repo/contents/path` | 待验证 |
| 读取文件内容 | `GET /repos/{owner}/{repo}/contents/{path}` | `gh api .([^0-9]). 
 
| jq -r .content | base64 -d` | 待验证 |
| 搜索代码 | `GET /search/code` | `gh search code "query"` | 待验证 |
| 提交历史 | `GET /repos/{owner}/{repo}/commits` | `gh api repos/owner/repo/commits` | 待验证 |
| Issues 列表 | `GET /repos/{owner}/{repo}/issues` | `gh issue list --repo owner/repo` | 待验证 |
| PR 列表 | `GET /repos/{owner}/{repo}/pulls` | `gh pr list --repo owner/repo` | 待验证 |
| 创建工作流触发 | `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` | `gh workflow run id --repo owner/repo` | 待验证 |
| 创建 Issue | `POST /repos/{owner}/{repo}/issues` | `gh issue create --repo owner/repo` | 待验证 |

## 参考资源

- [GitHub CLI 官方文档](https://cli.github.com/manual/)
- [GitHub REST API 文档](https://docs.github.com/en/rest)
- [GitHub CLI GitHub 仓库](https://github.com/cli/cli)
