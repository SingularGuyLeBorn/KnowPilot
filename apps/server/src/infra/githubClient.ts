/**
 * GitHub API Client — 对标 MetaBlog githubToolExecutor
 *
 * 统一封装 GitHub REST API 调用，自动注入 Bearer Token，提供常用操作快捷函数。
 */

import type { AppConfig } from "./config.js";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
}

export function getGitHubToken(config: AppConfig): string {
  return config.integrations.github.token || "";
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function githubApiRequest<T = unknown>(
  endpoint: string,
  options: GitHubApiOptions = {},
): Promise<T> {
  const token = options.token || "";
  const url = `${GITHUB_API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "KnowPilot/1.0",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = {
    method: options.method || "GET",
    headers,
  };
  if (options.body !== undefined && options.method !== "GET") {
    init.body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (res.ok) return data as T;

    const message = (data as { message?: string })?.message || res.statusText;
    lastError = new Error(`GitHub API 失败: ${res.status} ${message}`);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_RETRIES) break;

    const retryAfter = Number(res.headers.get("retry-after") || 0);
    const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt + Math.floor(Math.random() * 200);
    await sleep(backoff);
  }
  throw lastError ?? new Error("GitHub API 失败");
}

export function parseRepo(repo: string): { owner: string; repoName: string } {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('仓库格式必须是 "owner/repo"');
  }
  return { owner: parts[0], repoName: parts[1] };
}

export function toBase64(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

/* ─── Repository ─── */

export async function githubGetRepo(owner: string, repo: string, token?: string) {
  return githubApiRequest(`/repos/${owner}/${repo}`, { token });
}

export async function githubCreateRepo(
  name: string,
  options: { description?: string; private?: boolean; autoInit?: boolean },
  token?: string,
) {
  return githubApiRequest("/user/repos", {
    method: "POST",
    body: { name, ...options },
    token,
  });
}

export async function githubUpdateRepo(
  owner: string,
  repo: string,
  options: { description?: string; private?: boolean; default_branch?: string },
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}`, {
    method: "PATCH",
    body: options,
    token,
  });
}

export async function githubDeleteRepo(owner: string, repo: string, token?: string) {
  return githubApiRequest(`/repos/${owner}/${repo}`, { method: "DELETE", token });
}

/* ─── File contents ─── */

export interface GitHubFileContent {
  content?: string;
  sha?: string;
  message?: string;
  name?: string;
  path?: string;
  html_url?: string;
  download_url?: string;
}

export async function githubGetFile(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  token?: string,
): Promise<GitHubFileContent & { decodedContent?: string }> {
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = (await githubApiRequest(`/repos/${owner}/${repo}/contents/${path}${params}`, {
    token,
  })) as GitHubFileContent & { decodedContent?: string };
  if (data.content && typeof data.content === "string") {
    data.decodedContent = Buffer.from(data.content, "base64").toString("utf8");
  }
  return data;
}

export async function githubCreateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: {
      message,
      content: toBase64(content),
      ...(branch ? { branch } : {}),
    },
    token,
  });
}

export async function githubUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha: string,
  branch?: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: {
      message,
      content: toBase64(content),
      sha,
      ...(branch ? { branch } : {}),
    },
    token,
  });
}

export async function githubDeleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string,
  branch?: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    body: { message, sha, ...(branch ? { branch } : {}) },
    token,
  });
}

/* ─── Issues ─── */

export async function githubListIssues(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  perPage = 30,
  page = 1,
  token?: string,
) {
  const query = new URLSearchParams({ state, per_page: String(perPage), page: String(page) });
  return githubApiRequest(`/repos/${owner}/${repo}/issues?${query.toString()}`, { token });
}

export async function githubGetIssue(owner: string, repo: string, issueNumber: number, token?: string) {
  return githubApiRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, { token });
}

export async function githubCreateIssue(
  owner: string,
  repo: string,
  title: string,
  body?: string,
  labels?: string[],
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: { title, body, labels },
    token,
  });
}

export async function githubUpdateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: { title?: string; body?: string; state?: "open" | "closed"; labels?: string[] },
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: options,
    token,
  });
}

/* ─── Pull Requests ─── */

export async function githubListPullRequests(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  perPage = 30,
  page = 1,
  token?: string,
) {
  const query = new URLSearchParams({ state, per_page: String(perPage), page: String(page) });
  return githubApiRequest(`/repos/${owner}/${repo}/pulls?${query.toString()}`, { token });
}

export async function githubGetPullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
}

export async function githubCreatePullRequest(
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: { title, head, base, body },
    token,
  });
}

export async function githubUpdatePullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  options: { title?: string; body?: string; state?: "open" | "closed"; base?: string },
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
    method: "PATCH",
    body: options,
    token,
  });
}

export async function githubMergePullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  options: { commit_title?: string; commit_message?: string; merge_method?: "merge" | "squash" | "rebase" } = {},
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
    method: "PUT",
    body: options,
    token,
  });
}

export async function githubCreateIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body },
    token,
  });
}

/* ─── Branches ─── */

export async function githubListBranches(
  owner: string,
  repo: string,
  perPage = 30,
  page = 1,
  token?: string,
) {
  const query = new URLSearchParams({ per_page: String(perPage), page: String(page) });
  return githubApiRequest(`/repos/${owner}/${repo}/branches?${query.toString()}`, { token });
}

export async function githubGetBranch(owner: string, repo: string, branch: string, token?: string) {
  return githubApiRequest(`/repos/${owner}/${repo}/branches/${branch}`, { token });
}

export async function githubCreateBranch(
  owner: string,
  repo: string,
  newBranch: string,
  fromBranch: string,
  token?: string,
) {
  const base = (await githubGetBranch(owner, repo, fromBranch, token)) as { commit: { sha: string } };
  return githubApiRequest(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${newBranch}`, sha: base.commit.sha },
    token,
  });
}

export async function githubDeleteBranch(owner: string, repo: string, branch: string, token?: string) {
  return githubApiRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "DELETE",
    token,
  });
}

/* ─── Workflows ─── */

export async function githubListWorkflows(owner: string, repo: string, token?: string) {
  const data = (await githubApiRequest(`/repos/${owner}/${repo}/actions/workflows`, { token })) as {
    total_count: number;
    workflows: unknown[];
  };
  return data;
}

export async function githubTriggerWorkflow(
  owner: string,
  repo: string,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: "POST",
    body: { ref, inputs },
    token,
  });
}

/* ─── Releases ─── */

export async function githubCreateRelease(
  owner: string,
  repo: string,
  tagName: string,
  name: string,
  body?: string,
  targetCommitish?: string,
  token?: string,
) {
  return githubApiRequest(`/repos/${owner}/${repo}/releases`, {
    method: "POST",
    body: {
      tag_name: tagName,
      name,
      body,
      ...(targetCommitish ? { target_commitish: targetCommitish } : {}),
    },
    token,
  });
}

/* ─── Search ─── */

export async function githubSearchRepos(query: string, perPage = 5, token?: string) {
  const url = new URL("/search/repositories", GITHUB_API_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));
  return githubApiRequest(url.pathname + url.search, { token });
}
