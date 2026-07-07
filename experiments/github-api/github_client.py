#!/usr/bin/env python3
"""
GitHub API 客户端封装

同时支持直接 REST API 调用(requests)和 gh CLI 命令参考. 
Agent 工具最终采用 REST API 方式,gh CLI 仅作为本地测试参考. 

等效 gh CLI 命令在 docstring 中标注,格式：
  gh> gh repo view owner/repo --json ...
"""

from __future__ import annotations

import base64
import os
import time
import warnings
from pathlib import Path
from typing import Any, Literal, Optional, cast
from urllib.parse import parse_qs, quote, urlparse

import requests
from dotenv import load_dotenv

# 加载 .env
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")


class GitHubError(Exception):
    """GitHub API 错误"""

    def __init__(
        self,
        status: int,
        message: str,
        response_body: Optional[str] = None,
        rate_limit_reset: Optional[int] = None,
    ):
        self.status = status
        self.message = message
        self.response_body = response_body
        self.rate_limit_reset = rate_limit_reset
        super().__init__(f"[{status}] {message}")


class RateLimitError(GitHubError):
    """GitHub API 速率限制错误"""

    pass


class GitHubClient:
    """
    GitHub REST API 客户端

    gh> gh auth status
    """

    BASE_URL = "https://api.github.com"
    GRAPHQL_URL = "https://api.github.com/graphql"

    def __init__(self, token: Optional[str] = None):
        self.token = token or os.getenv("GITHUB_TOKEN") or os.getenv("VITE_GITHUB_TOKEN")
        if not self.token:
            warnings.warn("GitHub token 未提供,部分 API(尤其是搜索)将不可用", stacklevel=2)
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "MetaBlog-GitHub-Lab/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        })

    # ---------- 通用请求 ----------

    def _handle_rate_limit(self, resp: requests.Response) -> None:
        """检查响应头中的速率限制状态,必要时抛出异常"""
        remaining = resp.headers.get("X-RateLimit-Remaining")
        reset_ts = resp.headers.get("X-RateLimit-Reset")
        if remaining is not None and int(remaining) == 0 and reset_ts is not None:
            reset_at = int(reset_ts)
            wait_seconds = max(reset_at - int(time.time()), 0)
            raise RateLimitError(
                status=resp.status_code,
                message=f"Rate limit exceeded. Resets in {wait_seconds}s (at {reset_at})",
                rate_limit_reset=reset_at,
            )

    def request(
        self,
        method: str,
        endpoint: str,
        **kwargs: Any,
    ) -> Any:
        """发送请求并处理错误"""
        url = f"{self.BASE_URL}{endpoint}"
        resp = self.session.request(method, url, **kwargs)

        # Rate limit check (defensive: only when headers present)
        self._handle_rate_limit(resp)

        if not resp.ok:
            body = resp.text[:500] if resp.text else None
            raise GitHubError(resp.status_code, resp.reason, body)

        # 204 No Content
        if resp.status_code == 204:
            return {}

        return resp.json()

    def get(
        self,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        return self.request("GET", endpoint, params=params)

    def post(
        self,
        endpoint: str,
        json_data: Optional[dict[str, Any]] = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        data = self.request("POST", endpoint, json=json_data, **kwargs)
        assert isinstance(data, dict), f"POST {endpoint} expected dict, got {type(data).__name__}"
        return data

    def patch(
        self,
        endpoint: str,
        json_data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        data = self.request("PATCH", endpoint, json=json_data)
        assert isinstance(data, dict), f"PATCH {endpoint} expected dict, got {type(data).__name__}"
        return data

    def put(
        self,
        endpoint: str,
        json_data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        data = self.request("PUT", endpoint, json=json_data)
        assert isinstance(data, dict), f"PUT {endpoint} expected dict, got {type(data).__name__}"
        return data

    def delete(
        self,
        endpoint: str,
        json_data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        data = self.request("DELETE", endpoint, json=json_data)
        assert isinstance(data, dict), f"DELETE {endpoint} expected dict, got {type(data).__name__}"
        return data

    # ---------- 分页 ----------

    def paginate(
        self,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
        max_pages: int = 5,
    ) -> list[dict[str, Any]]:
        """
        自动翻页获取列表数据

        GitHub API 在响应头 Link 中提供下一页链接,此方法自动解析并拼接结果. 
        注意：会消耗更多请求配额,大量分页时请控制 max_pages. 
        """
        results: list[dict[str, Any]] = []
        url = f"{self.BASE_URL}{endpoint}"
        query_params = dict(params) if params else {}
        page = query_params.get("page", 1)
        per_page = query_params.get("per_page", 30)

        for _ in range(max_pages):
            resp = self.session.get(url, params=query_params)
            self._handle_rate_limit(resp)
            if not resp.ok:
                body = resp.text[:500] if resp.text else None
                raise GitHubError(resp.status_code, resp.reason, body)

            data = resp.json()
            if isinstance(data, list):
                results.extend(data)
            elif isinstance(data, dict) and "items" in data:
                results.extend(data["items"])
            else:
                break

            # 解析 Link header
            link_header = resp.headers.get("Link", "")
            next_url = None
            for part in link_header.split(","):
                if 'rel="next"' in part:
                    next_url = part[part.index("<") + 1 : part.index(">")]
                    break

            if not next_url:
                break

            # 更新 URL 和 params 为下一页
            parsed = urlparse(next_url)
            url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            query_params = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        return results

    # ---------- GraphQL ----------

    def graphql(
        self,
        query: str,
        variables: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        调用 GitHub GraphQL API

        对于复杂查询(如批量获取 PR 文件列表、关联数据),GraphQL 通常比 REST 更高效. 
        """
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables
        resp = self.session.post(self.GRAPHQL_URL, json=payload)
        self._handle_rate_limit(resp)
        if not resp.ok:
            body = resp.text[:500] if resp.text else None
            raise GitHubError(resp.status_code, resp.reason, body)
        return resp.json()

    # ---------- 认证 & 健康 ----------

    def health_check(self) -> dict[str, Any]:
        """
        验证 Token 是否有效

        gh> gh auth status
        """
        try:
            resp = self.session.get(f"{self.BASE_URL}/user")
            self._handle_rate_limit(resp)
            if not resp.ok:
                body = resp.text[:500] if resp.text else None
                raise GitHubError(resp.status_code, resp.reason, body)
            user = resp.json()
            return {
                "ok": True,
                "login": user.get("login"),
                "rate_limit_remaining": resp.headers.get("X-RateLimit-Remaining"),
                "rate_limit_limit": resp.headers.get("X-RateLimit-Limit"),
            }
        except GitHubError as e:
            return {"ok": False, "error": e.message, "status": e.status}

    def get_rate_limit(self) -> dict[str, Any]:
        """
        获取当前速率限制状态

        gh> gh api rate_limit
        """
        return self.get("/rate_limit")

    # ---------- 仓库 ----------

    def get_repo(self, owner: str, repo: str) -> dict[str, Any]:
        """
        获取仓库信息

        gh> gh repo view owner/repo --json name,description,stargazersCount,forksCount,primaryLanguage,pushedAt
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}")
    
    def update_repo(
        self,
        owner: str,
        repo: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        private: Optional[bool] = None,
        visibility: Optional[Literal["public", "private", "internal"]] = None,
        archived: Optional[bool] = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        更新仓库设置(可见性、描述、归档等)

        gh> gh repo edit owner/repo --visibility private
        """
        payload: dict[str, Any] = {}
        if name is not None:
            payload["name"] = name
        if description is not None:
            payload["description"] = description
        if visibility is not None:
            payload["visibility"] = visibility
        elif private is not None:
            payload["private"] = private
        if archived is not None:
            payload["archived"] = archived
        payload.update(kwargs)
        return self.patch(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}",
            json_data=payload,
        )
    
    def list_repos(
        self,
        owner: str,
        type_: Literal["owner", "member", "all"] = "owner",
        per_page: int = 30,
    ) -> list[dict[str, Any]]:
        """
        列出用户/组织的仓库

        gh> gh repo list owner --limit 30
        """
        return self.get(f"/users/{quote(owner, safe='')}/repos", params={"type": type_, "per_page": per_page})

    def search_repos(self, query: str, per_page: int = 10) -> dict[str, Any]:
        """
        搜索仓库

        gh> gh search repos "query" --limit 10
        """
        return self.get("/search/repositories", params={"q": query, "per_page": per_page})

    def fork_repo(
        self,
        owner: str,
        repo: str,
        organization: Optional[str] = None,
        name: Optional[str] = None,
        default_branch_only: bool = False,
    ) -> dict[str, Any]:
        """
        Fork 仓库

        gh> gh repo fork owner/repo --org my-org --default-branch-only
        """
        payload: dict[str, Any] = {}
        if organization:
            payload["organization"] = organization
        if name:
            payload["name"] = name
        if default_branch_only:
            payload["default_branch_only"] = True
        return self.post(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/forks", json_data=payload or None)

    # ---------- 内容(类型安全) ----------

    def list_contents(
        self,
        owner: str,
        repo: str,
        path: str = "",
        ref: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """
        获取仓库**目录**内容(保证返回列表)

        gh> gh api repos/owner/repo/contents/path
        """
        params: dict[str, str] = {}
        if ref:
            params["ref"] = ref
        data = self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/contents/{quote(path, safe='')}",
            params=params,
        )
        if isinstance(data, dict):
            raise GitHubError(400, f"'{path or '/'}' 是一个文件,不是目录. 请使用 get_file_metadata()")
        return data

    def get_file_metadata(
        self,
        owner: str,
        repo: str,
        path: str,
        ref: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        获取**文件**元数据(保证返回字典)

        gh> gh api repos/owner/repo/contents/path
        """
        params: dict[str, str] = {}
        if ref:
            params["ref"] = ref
        data = self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/contents/{quote(path, safe='')}",
            params=params,
        )
        if isinstance(data, list):
            raise GitHubError(400, f"'{path}' 是一个目录,不是文件. 请使用 list_contents()")
        return data

    def get_contents(
        self,
        owner: str,
        repo: str,
        path: str = "",
        ref: Optional[str] = None,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        """
        获取仓库目录内容或文件元数据(底层方法,返回类型不确定)

        推荐优先使用类型安全的方法：
        - 目录 → list_contents()
        - 文件 → get_file_metadata()

        gh> gh api repos/owner/repo/contents/path
        """
        params: dict[str, str] = {}
        if ref:
            params["ref"] = ref
        return self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/contents/{quote(path, safe='')}",
            params=params,
        )

    def get_file_content(self, owner: str, repo: str, path: str, ref: Optional[str] = None) -> str:
        """
        获取文件原始内容(自动 base64 解码)

        gh> gh api repos/owner/repo/contents/path | jq -r .content | base64 -d
        """
        data = self.get_file_metadata(owner, repo, path, ref)
        content = data.get("content", "")
        if not content:
            return ""
        # GitHub API 返回的 base64 有换行符,需先清理
        return base64.b64decode(content.replace("\n", "")).decode("utf-8", errors="replace")

    def get_readme(self, owner: str, repo: str, ref: Optional[str] = None) -> str:
        """
        获取 README.md 原始内容

        gh> gh api repos/owner/repo/readme | jq -r .content | base64 -d
        """
        params: dict[str, str] = {}
        if ref:
            params["ref"] = ref
        data = self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/readme", params=params)
        content = data.get("content", "")
        if not content:
            return ""
        return base64.b64decode(content.replace("\n", "")).decode("utf-8", errors="replace")

    # ---------- 分支 ----------

    def list_branches(self, owner: str, repo: str, per_page: int = 30) -> list[dict[str, Any]]:
        """
        列出分支

        gh> gh api repos/owner/repo/branches?per_page=30
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/branches", params={"per_page": per_page})

    def get_branch(self, owner: str, repo: str, branch: str) -> dict[str, Any]:
        """
        获取单个分支信息

        gh> gh api repos/owner/repo/branches/main
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/branches/{quote(branch, safe='')}")

    def create_branch(self, owner: str, repo: str, branch: str, from_branch: str = "main") -> dict[str, Any]:
        """
        基于现有分支创建新分支

        gh> gh api repos/owner/repo/git/refs -f ref='refs/heads/new-branch' -f sha=<sha>
        """
        base = self.get_branch(owner, repo, from_branch)
        sha = base["commit"]["sha"]
        return self.post(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/git/refs",
            json_data={"ref": f"refs/heads/{branch}", "sha": sha},
        )

    # ---------- 提交 ----------

    def get_commits(
        self,
        owner: str,
        repo: str,
        path: Optional[str] = None,
        sha: Optional[str] = None,
        per_page: int = 10,
    ) -> list[dict[str, Any]]:
        """
        获取提交历史

        gh> gh api repos/owner/repo/commits?per_page=10
        """
        params: dict[str, str | int] = {"per_page": per_page}
        if path:
            params["path"] = path
        if sha:
            params["sha"] = sha
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/commits", params=params)

    def compare_commits(self, owner: str, repo: str, base: str, head: str) -> dict[str, Any]:
        """
        比较两个分支/提交之间的差异

        gh> gh api repos/owner/repo/compare/base...head
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/compare/{quote(base, safe='')}...{quote(head, safe='')}")

    # ---------- Issue ----------

    def list_issues(
        self,
        owner: str,
        repo: str,
        state: Literal["open", "closed", "all"] = "open",
        per_page: int = 10,
    ) -> list[dict[str, Any]]:
        """
        列出 Issues

        gh> gh issue list --repo owner/repo --state open --limit 10
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues", params={"state": state, "per_page": per_page})

    def get_issue(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        """
        获取单个 Issue 详情

        gh> gh issue view 123 --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/{number}")

    def create_issue(
        self,
        owner: str,
        repo: str,
        title: str,
        body: Optional[str] = None,
        labels: Optional[list[str]] = None,
        assignees: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """
        创建 Issue

        gh> gh issue create --repo owner/repo --title "xxx" --body "yyy" --label bug
        """
        payload: dict[str, Any] = {"title": title}
        if body:
            payload["body"] = body
        if labels:
            payload["labels"] = labels
        if assignees:
            payload["assignees"] = assignees
        return self.post(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues", json_data=payload)

    def update_issue(
        self,
        owner: str,
        repo: str,
        number: int,
        title: Optional[str] = None,
        body: Optional[str] = None,
        state: Optional[Literal["open", "closed"]] = None,
        labels: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """
        更新 Issue

        gh> gh issue edit 123 --repo owner/repo --title "new title" --body "new body"
        """
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        if state is not None:
            payload["state"] = state
        if labels is not None:
            payload["labels"] = labels
        return self.patch(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/{number}", json_data=payload)

    def list_issue_comments(self, owner: str, repo: str, number: int, per_page: int = 30) -> list[dict[str, Any]]:
        """
        获取 Issue / PR 的评论列表

        gh> gh api repos/owner/repo/issues/123/comments
        """
        return self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/{number}/comments",
            params={"per_page": per_page},
        )

    def create_issue_comment(self, owner: str, repo: str, number: int, body: str) -> dict[str, Any]:
        """
        在 Issue / PR 下添加评论

        gh> gh issue comment 123 --repo owner/repo --body "comment"
        """
        return self.post(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/{number}/comments",
            json_data={"body": body},
        )

    # ---------- Pull Request ----------

    def list_pulls(
        self,
        owner: str,
        repo: str,
        state: Literal["open", "closed", "all"] = "open",
        per_page: int = 10,
    ) -> list[dict[str, Any]]:
        """
        列出 Pull Requests

        gh> gh pr list --repo owner/repo --state open --limit 10
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls", params={"state": state, "per_page": per_page})

    def get_pull(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        """
        获取单个 PR 详情

        gh> gh pr view 123 --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls/{number}")

    def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: Optional[str] = None,
        draft: bool = False,
    ) -> dict[str, Any]:
        """
        创建 Pull Request

        gh> gh pr create --repo owner/repo --title "xxx" --head feature --base main --body "yyy"
        """
        payload: dict[str, Any] = {
            "title": title,
            "head": head,
            "base": base,
            "draft": draft,
        }
        if body:
            payload["body"] = body
        return self.post(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls", json_data=payload)

    def merge_pull_request(
        self,
        owner: str,
        repo: str,
        number: int,
        merge_method: Literal["merge", "squash", "rebase"] = "merge",
        commit_title: Optional[str] = None,
        commit_message: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        合并 Pull Request

        gh> gh pr merge 123 --repo owner/repo --merge --subject "title" --body "body"
        """
        payload: dict[str, Any] = {"merge_method": merge_method}
        if commit_title:
            payload["commit_title"] = commit_title
        if commit_message:
            payload["commit_message"] = commit_message
        return self.put(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls/{number}/merge", json_data=payload)

    def get_pull_request_files(self, owner: str, repo: str, number: int, per_page: int = 100) -> list[dict[str, Any]]:
        """
        获取 PR 的文件变更列表

        gh> gh api repos/owner/repo/pulls/123/files
        """
        return self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls/{number}/files",
            params={"per_page": per_page},
        )

    def get_pull_request_status(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        """
        获取 PR 的合并状态检查(combined status)

        gh> gh pr checks 123 --repo owner/repo
        """
        # 先获取 PR 的 head sha,再查 status
        pr = self.get_pull(owner, repo, number)
        sha = pr["head"]["sha"]
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/commits/{sha}/status")

    # ---------- 搜索 ----------

    def search_code(self, query: str, per_page: int = 10) -> dict[str, Any]:
        """
        搜索代码

        gh> gh search code "query" --limit 10
        """
        return self.get("/search/code", params={"q": query, "per_page": per_page})

    def search_issues(self, query: str, per_page: int = 10) -> dict[str, Any]:
        """
        搜索 Issues / PRs

        gh> gh search issues "query" --limit 10
        """
        return self.get("/search/issues", params={"q": query, "per_page": per_page})

    # ---------- Actions Workflow ----------

    def list_workflows(self, owner: str, repo: str) -> dict[str, Any]:
        """
        列出仓库的工作流

        gh> gh workflow list --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/actions/workflows")

    def list_workflow_runs(self, owner: str, repo: str, per_page: int = 10) -> dict[str, Any]:
        """
        列出工作流运行记录

        gh> gh run list --repo owner/repo --limit 10
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/actions/runs", params={"per_page": per_page})

    def trigger_workflow(
        self,
        owner: str,
        repo: str,
        workflow_id: str,
        ref: str = "main",
        inputs: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        触发工作流运行

        gh> gh workflow run workflow_id --repo owner/repo --ref main
        """
        payload: dict[str, Any] = {"ref": ref}
        if inputs:
            payload["inputs"] = inputs
        return self.post(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/actions/workflows/{workflow_id}/dispatches",
            json_data=payload,
        )

    # ---------- Release ----------

    def list_releases(self, owner: str, repo: str, per_page: int = 30) -> list[dict[str, Any]]:
        """
        列出 Releases

        gh> gh release list --repo owner/repo --limit 30
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases", params={"per_page": per_page})

    def get_release(self, owner: str, repo: str, release_id: int) -> dict[str, Any]:
        """
        获取单个 Release

        gh> gh release view <tag> --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases/{release_id}")

    def get_latest_release(self, owner: str, repo: str) -> dict[str, Any]:
        """
        获取最新 Release

        gh> gh release view --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases/latest")

    def create_release(
        self,
        owner: str,
        repo: str,
        tag_name: str,
        name: Optional[str] = None,
        body: Optional[str] = None,
        draft: bool = False,
        prerelease: bool = False,
        target_commitish: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        创建 Release

        gh> gh release create v1.0.0 --repo owner/repo --title "Release" --notes "..."
        """
        payload: dict[str, Any] = {
            "tag_name": tag_name,
            "draft": draft,
            "prerelease": prerelease,
        }
        if name:
            payload["name"] = name
        if body:
            payload["body"] = body
        if target_commitish:
            payload["target_commitish"] = target_commitish
        return self.post(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases", json_data=payload)

    def update_release(
        self,
        owner: str,
        repo: str,
        release_id: int,
        tag_name: Optional[str] = None,
        name: Optional[str] = None,
        body: Optional[str] = None,
        draft: Optional[bool] = None,
        prerelease: Optional[bool] = None,
    ) -> dict[str, Any]:
        """
        更新 Release

        gh> gh release edit v1.0.0 --repo owner/repo --title "New Title"
        """
        payload: dict[str, Any] = {}
        if tag_name is not None:
            payload["tag_name"] = tag_name
        if name is not None:
            payload["name"] = name
        if body is not None:
            payload["body"] = body
        if draft is not None:
            payload["draft"] = draft
        if prerelease is not None:
            payload["prerelease"] = prerelease
        return self.patch(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases/{release_id}", json_data=payload)

    def delete_release(self, owner: str, repo: str, release_id: int) -> dict[str, Any]:
        """
        删除 Release

        gh> gh release delete v1.0.0 --repo owner/repo --yes
        """
        return self.delete(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/releases/{release_id}")

    # ---------- 文件操作 ----------

    def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str = "main",
        sha: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        创建或更新仓库中的文件

        gh> gh api repos/owner/repo/contents/path -X PUT -f message="..." -f content="..." -f branch="main"
        """
        import base64

        payload: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha
        return self.put(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/contents/{quote(path, safe='')}",
            json_data=payload,
        )

    def delete_file(
        self,
        owner: str,
        repo: str,
        path: str,
        message: str,
        sha: str,
        branch: str = "main",
    ) -> dict[str, Any]:
        """
        删除仓库中的文件

        gh> gh api repos/owner/repo/contents/path -X DELETE -f message="..." -f sha="..." -f branch="main"
        """
        return self.delete(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/contents/{quote(path, safe='')}",
            json_data={"message": message, "sha": sha, "branch": branch},
        )

    # ---------- 评论删改 ----------

    def update_issue_comment(self, owner: str, repo: str, comment_id: int, body: str) -> dict[str, Any]:
        """
        更新 Issue / PR 评论

        gh> gh api repos/owner/repo/issues/comments/123 -X PATCH -f body="new body"
        """
        return self.patch(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/comments/{comment_id}",
            json_data={"body": body},
        )

    def delete_issue_comment(self, owner: str, repo: str, comment_id: int) -> dict[str, Any]:
        """
        删除 Issue / PR 评论

        gh> gh api repos/owner/repo/issues/comments/123 -X DELETE
        """
        return self.delete(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/issues/comments/{comment_id}")

    # ---------- PR Review ----------

    def list_pull_request_reviews(self, owner: str, repo: str, number: int, per_page: int = 30) -> list[dict[str, Any]]:
        """
        列出 PR 的 Reviews

        gh> gh pr view 123 --repo owner/repo --reviews
        """
        return self.get(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls/{number}/reviews",
            params={"per_page": per_page},
        )

    def create_pull_request_review(
        self,
        owner: str,
        repo: str,
        number: int,
        event: Optional[Literal["APPROVE", "REQUEST_CHANGES", "COMMENT"]] = None,
        body: Optional[str] = None,
        comments: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """
        创建 PR Review

        gh> gh pr review 123 --repo owner/repo --approve --body "LGTM"
        """
        payload: dict[str, Any] = {}
        if event:
            payload["event"] = event
        if body:
            payload["body"] = body
        if comments:
            payload["comments"] = comments
        return self.post(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/pulls/{number}/reviews",
            json_data=payload,
        )

    # ---------- Labels ----------

    def list_labels(self, owner: str, repo: str, per_page: int = 30) -> list[dict[str, Any]]:
        """
        列出仓库 Labels

        gh> gh label list --repo owner/repo --limit 30
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/labels", params={"per_page": per_page})

    def create_label(self, owner: str, repo: str, name: str, color: str, description: Optional[str] = None) -> dict[str, Any]:
        """
        创建 Label

        gh> gh label create bug --repo owner/repo --color ff0000 --description "Something is broken"
        """
        payload: dict[str, Any] = {"name": name, "color": color.lstrip("#")}
        if description:
            payload["description"] = description
        return self.post(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/labels", json_data=payload)

    def delete_label(self, owner: str, repo: str, name: str) -> dict[str, Any]:
        """
        删除 Label

        gh> gh label delete bug --repo owner/repo --yes
        """
        return self.delete(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/labels/{quote(name, safe='')}")

    # ---------- Actions Run ----------

    def get_workflow_run(self, owner: str, repo: str, run_id: int) -> dict[str, Any]:
        """
        获取单个工作流运行详情

        gh> gh run view 1234567890 --repo owner/repo
        """
        return self.get(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/actions/runs/{run_id}")

    # ---------- 分支删除 ----------

    def delete_branch(self, owner: str, repo: str, branch: str) -> dict[str, Any]:
        """
        删除分支

        gh> gh api repos/owner/repo/git/refs/heads/branch-name -X DELETE
        """
        return self.delete(
            f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/git/refs/heads/{quote(branch, safe='')}"
        )

    # ---------- 仓库创建/删除 ----------

    def create_repo(
        self,
        name: str,
        description: Optional[str] = None,
        private: bool = False,
        auto_init: bool = False,
    ) -> dict[str, Any]:
        """
        创建用户仓库

        gh> gh repo create name --description "..." --private --add-readme
        """
        payload: dict[str, Any] = {
            "name": name,
            "private": private,
            "auto_init": auto_init,
        }
        if description:
            payload["description"] = description
        return self.post("/user/repos", json_data=payload)

    def delete_repo(self, owner: str, repo: str) -> dict[str, Any]:
        """
        删除仓库(危险操作！)

        gh> gh repo delete owner/repo --yes
        """
        return self.delete(f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}")


# ---------- 便捷函数 ----------


def format_repo_info(data: dict[str, Any]) -> str:
    """格式化仓库信息为可读文本"""
    lines = [
        f"📦 {data.get('full_name', 'N/A')}",
        f"   ⭐ {data.get('stargazers_count', 0):,}  🍴 {data.get('forks_count', 0):,}  🐛 {data.get('open_issues_count', 0):,}",
        f"   📝 {data.get('description') or '无描述'}",
        f"   🔤 主要语言: {data.get('language') or 'N/A'}",
        f"   🕐 更新于: {data.get('pushed_at', 'N/A')}",
        f"   🔗 {data.get('html_url', '')}",
    ]
    return "\n".join(lines)


def format_issue(item: dict[str, Any]) -> str:
    """格式化 Issue 为单行文本"""
    return f"#{item.get('number')} [{item.get('state')}] {item.get('title')} — @{item.get('user', {}).get('login', '?')}"


def format_pull(item: dict[str, Any]) -> str:
    """格式化 PR 为单行文本"""
    return f"#{item.get('number')} [{item.get('state')}] {item.get('title')} — @{item.get('user', {}).get('login', '?')}"


def format_commit(item: dict[str, Any]) -> str:
    """格式化提交为单行文本"""
    commit = item.get("commit", {})
    msg = commit.get("message", "").split("\n")[0]
    sha = item.get("sha", "")[:7]
    author = commit.get("author", {}).get("name", "?")
    return f"{sha} {msg[:60]} — {author}"
