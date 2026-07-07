/**
 * ============================================================================
 * 工具函数 - github-tool-executor
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/utils
 */


/**
 * ============================================================================
 * GitHub 工具执行器
 * ============================================================================
 *
 * 所有 GitHub 工具的业务逻辑集中在这里. 
 * 前端工具只需调用本层的 executeGitHubTool(toolName, params)
 *
 * 职责: ? * - 参数校验(第一道防线)
 * - GitHub API 调用
 * - 结果格式化(精简字段,避免 context bloat.  * - 错误翻译(中文友好提示)
 * - base64 编解码. ? */

import { translateGitHubError } from "./githubErrorTranslator.js";
import * as validators from "./githubValidators.js";

const GITHUB_API_BASE = "https://api.github.com";

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }
  return "";
}

let overrideToken = "";

export function setGitHubToken(token: string): void {
  overrideToken = token;
}

function getToken(): string {
  return overrideToken || readEnv("GITHUB_TOKEN", "VITE_GITHUB_TOKEN");
}

// ─────────────────────────────────────────────────────────────────────────────
// 底层 HTTP 客户端
// ─────────────────────────────────────────────────────────────────────────────

async function githubApiRequest(
  endpoint: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<any> {
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API_BASE}${endpoint}`;
  const token = getToken();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "KnowPilot/1.0",
    ...options.headers,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`GitHub API ${response.status}: ${text}`) as any;
    err.status = response.status;
    err.responseText = text;
    throw err;
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return {};
  }

  return response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function encodeRefPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function encodeFilePath(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, "/");
}

function decodeBase64(str: string): string {
  str = str.replace(/\n/g, "");
  try {
    return Buffer.from(str, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function ok(data: any, display: string, toolName: string, code?: number) {
  return { success: true as const, data, display, toolName, code };
}

function err(raw: string, translation: { message: string; suggestion: string }, toolName: string, code?: number) {
  return { success: false as const, error: raw, message: translation.message, suggestion: translation.suggestion, toolName, code };
}

function validate(result: validators.ValidationResult): string | null {
  return result.valid ? null : result.error!.message;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具执行函数
// ─────────────────────────────────────────────────────────────────────────────

// ====== repo ======

async function githubGetRepo(params: any) {
  const { owner, repo } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "示例: owner='facebook', repo='react'" }, "githubGetRepo");

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}`);
    return ok(
      {
        fullName: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        language: data.language,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        url: data.html_url,
      },
      `仓库: ${data.full_name} ⭐${data.stargazers_count.toLocaleString()}`,
      "githubGetRepo"
    );
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetRepo", e.status);
  }
}

async function githubListRepoContents(params: any) {
  const { owner, repo, path = "", ref } = params;
  let v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListRepoContents");
  v = validate(validators.validatePath(path));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListRepoContents");

  try {
    let endpoint = `/repos/${owner}/${repo}/contents/${encodeFilePath(path)}`;
    if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
    const contents = await githubApiRequest(endpoint);
    const items = Array.isArray(contents)
      ? contents.map((item: any) => ({ name: item.name, type: item.type, path: item.path, size: item.size }))
      : [{ name: contents.name, type: contents.type, path: contents.path, size: contents.size }];
    return ok(items, `${owner}/${repo}/${path || ""} (${items.length} 个)`, "githubListRepoContents");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListRepoContents", e.status);
  }
}

async function githubGetFileContent(params: any) {
  const { owner, repo, path, ref, max_length = 5000 } = params;
  let v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetFileContent");
  if (!path || typeof path !== "string") {
    return err("Validation", { message: "请提供文件路径(path)", suggestion: "" }, "githubGetFileContent");
  }
  v = validate(validators.validatePath(path));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetFileContent");

  try {
    let endpoint = `/repos/${owner}/${repo}/contents/${encodeFilePath(path)}`;
    if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
    const data = await githubApiRequest(endpoint);
    if (!data.content) {
      return err("No content", { message: "无法获取文件内容", suggestion: "该文件可能是目录或没有内容" }, "githubGetFileContent");
    }
    const rawContent = decodeBase64(data.content);
    const isTruncated = rawContent.length > max_length;
    const content = isTruncated
      ? rawContent.substring(0, max_length) +
      `\n\n---\n[内容已截断] 文件共 ${rawContent.length} 字符,当前限制 ${max_length} 字符. `
      : rawContent;
    return ok({ name: data.name, path: data.path, size: data.size, content, truncated: isTruncated }, `${data.name} (${data.size} bytes${isTruncated ? ",已截断," + max_length + " 字符" : ""})`, "githubGetFileContent");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetFileContent", e.status);
  }
}

async function githubSearchCode(params: any) {
  const { query, language, limit = 5 } = params;
  const v = validate(validators.validateQuery(query));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubSearchCode");

  try {
    let searchQuery = query;
    if (language) searchQuery += ` language:${language}`;
    const data = await githubApiRequest(`/search/code?q=${encodeURIComponent(searchQuery)}&per_page=${limit}`);
    const items = (data.items || []).map((item: any) => ({ repository: item.repository.full_name, path: item.path, url: item.html_url }));
    return ok(items, `找到 ${data.total_count || 0} 个结果(显示 ${items.length} 个)`, "githubSearchCode");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubSearchCode", e.status);
  }
}

async function githubGetCommitHistory(params: any) {
  const { owner, repo, path, per_page = 10 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetCommitHistory");

  try {
    let endpoint = `/repos/${owner}/${repo}/commits?per_page=${per_page}`;
    if (path) endpoint += `&path=${encodeURIComponent(path)}`;
    const commits = await githubApiRequest(endpoint);
    const items = commits.map((commit: any) => ({
      sha: commit.sha.substring(0, 7),
      message: commit.commit.message.split("\n")[0],
      author: commit.commit.author.name,
      date: commit.commit.author.date,
    }));
    return ok(items, `${owner}/${repo} 的最新 ${items.length} 条提交`, "githubGetCommitHistory");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetCommitHistory", e.status);
  }
}

async function githubGetReadme(params: any) {
  const { owner, repo, ref } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetReadme");

  try {
    let endpoint = `/repos/${owner}/${repo}/readme`;
    if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
    const data = await githubApiRequest(endpoint);
    const rawContent = decodeBase64(data.content);
    return ok({ name: data.name, path: data.path, content: rawContent, size: data.size }, `${data.name} (${data.size} bytes)`, "githubGetReadme");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetReadme", e.status);
  }
}

async function githubCompareCommits(params: any) {
  const { owner, repo, base, head } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCompareCommits");
  if (!base || !head) {
    return err("Validation", { message: "请提供 base 和 head 参数", suggestion: "" }, "githubCompareCommits");
  }

  try {
    const result = await githubApiRequest(`/repos/${owner}/${repo}/compare/${encodeRefPath(base)}...${encodeRefPath(head)}`);
    return ok(
      {
        status: result.status,
        ahead_by: result.ahead_by,
        behind_by: result.behind_by,
        total_commits: result.total_commits,
        files: result.files?.map((f: any) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
      },
      `${base}...${head}: ${result.status} (+${result.ahead_by}/-${result.behind_by}, ${result.total_commits} commits)`,
      "githubCompareCommits"
    );
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCompareCommits", e.status);
  }
}

async function githubGetRateLimit(_params: any) {
  try {
    const data = await githubApiRequest("/rate_limit");
    const core = data.resources?.core || {};
    const search = data.resources?.search || {};
    return ok({ core: { limit: core.limit, remaining: core.remaining, reset: core.reset }, search: { limit: search.limit, remaining: search.remaining, reset: search.reset } }, `API 配额: Core ${core.remaining}/${core.limit} | Search ${search.remaining}/${search.limit}`, "githubGetRateLimit");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetRateLimit", e.status);
  }
}

async function githubSearchRepos(params: any) {
  const { query, per_page = 10 } = params;
  const v = validate(validators.validateQuery(query));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubSearchRepos");

  try {
    const data = await githubApiRequest(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${per_page}`);
    const items = (data.items || []).map((r: any) => ({ full_name: r.full_name, description: r.description, stars: r.stargazers_count, forks: r.forks_count, language: r.language, url: r.html_url }));
    return ok({ total: data.total_count, items }, `找到 ${data.total_count} 个仓库(显示 ${items.length} 个)`, "githubSearchRepos");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubSearchRepos", e.status);
  }
}

async function githubCreateRepo(params: any) {
  const { name, description, private: isPrivate = false, auto_init = false } = params;
  if (!name || typeof name !== "string") {
    return err("Validation", { message: "请提供仓库名称(name)", suggestion: "" }, "githubCreateRepo");
  }

  try {
    const payload: any = { name, private: isPrivate, auto_init };
    if (description !== undefined) payload.description = description;
    const data = await githubApiRequest("/user/repos", { method: "POST", body: JSON.stringify(payload) });
    return ok({ name: data.name, full_name: data.full_name, url: data.html_url, private: data.private }, `仓库创建成功: ?{data.full_name} (${data.private ? "私有" : "公开"})\n${data.html_url}`, "githubCreateRepo");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    // 对 create_repo 的 422 做进一步语义增强: 如果是"已存在",给出更具体的操作指引
    if (t.message === "资源已存在") {
      return err(e.message, {
        message: `仓库 "${name}" 已存在,无法重复创建`,
        suggestion: "如需操作该仓库,请使用 githubGetRepo 查询详情,或使用 githubUpdateRepo 更新配置",
      }, "githubCreateRepo");
    }
    return err(e.message, t, "githubCreateRepo", e.status);
  }
}

async function githubUpdateRepo(params: any) {
  const { owner, repo, description, visibility, topics, has_issues, has_wiki, has_projects } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubUpdateRepo");

  try {
    const payload: any = {};
    if (description !== undefined) payload.description = description;
    if (visibility !== undefined) payload.visibility = visibility;
    if (topics !== undefined) payload.topics = topics;
    if (has_issues !== undefined) payload.has_issues = has_issues;
    if (has_wiki !== undefined) payload.has_wiki = has_wiki;
    if (has_projects !== undefined) payload.has_projects = has_projects;
    const data = await githubApiRequest(`/repos/${owner}/${repo}`, { method: "PATCH", body: JSON.stringify(payload) });
    return ok({ name: data.name, full_name: data.full_name, visibility: data.visibility, description: data.description }, `仓库 ${data.full_name} 更新成功`, "githubUpdateRepo");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubUpdateRepo", e.status);
  }
}

async function githubDeleteRepo(params: any) {
  const { owner, repo } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubDeleteRepo");

  try {
    await githubApiRequest(`/repos/${owner}/${repo}`, { method: "DELETE" });
    return ok({}, `仓库 ${owner}/${repo} 已删除`, "githubDeleteRepo");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubDeleteRepo", e.status);
  }
}

async function githubCreateRelease(params: any) {
  const { owner, repo, tag_name, name, body, draft = false, prerelease = false } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreateRelease");
  if (!tag_name) return err("Validation", { message: "请提供标签名(tag_name)", suggestion: "" }, "githubCreateRelease");

  try {
    const payload: any = { tag_name, draft, prerelease };
    if (name !== undefined) payload.name = name;
    if (body !== undefined) payload.body = body;
    const data = await githubApiRequest(`/repos/${owner}/${repo}/releases`, { method: "POST", body: JSON.stringify(payload) });
    return ok({ tag_name: data.tag_name, name: data.name, url: data.html_url }, `Release ${data.tag_name} 创建成功`, "githubCreateRelease");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreateRelease", e.status);
  }
}

// ====== issue ======

async function githubGetIssues(params: any) {
  const { owner, repo, state = "open", per_page = 10 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetIssues");

  try {
    const issues = await githubApiRequest(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${per_page}`);
    const items = issues
      .filter((issue: any) => !issue.pull_request)
      .map((issue: any) => ({ number: issue.number, title: issue.title, state: issue.state, author: issue.user.login, createdAt: issue.created_at }));
    return ok(items, `${owner}/${repo} 的 ${state} Issues (${items.length} 个)`, "githubGetIssues");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetIssues", e.status);
  }
}

async function githubCreateIssue(params: any) {
  const { owner, repo, title, body, labels } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreateIssue");
  if (!title) return err("Validation", { message: "请提供 Issue 标题(title)", suggestion: "" }, "githubCreateIssue");

  try {
    const payload: any = { title };
    if (body !== undefined) payload.body = body;
    if (labels && Array.isArray(labels)) payload.labels = labels;
    const issue = await githubApiRequest(`/repos/${owner}/${repo}/issues`, { method: "POST", body: JSON.stringify(payload) });
    return ok({ number: issue.number, title: issue.title, state: issue.state, url: issue.html_url, createdAt: issue.created_at }, `成功创建 Issue #${issue.number}: ${issue.title}`, "githubCreateIssue");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreateIssue", e.status);
  }
}

async function githubCreateIssueComment(params: any) {
  const { owner, repo, number, body } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreateIssueComment");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubCreateIssueComment");
  if (!body) return err("Validation", { message: "请提供评论内容(body)", suggestion: "" }, "githubCreateIssueComment");

  try {
    const comment = await githubApiRequest(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    return ok({ id: comment.id, url: comment.html_url }, `成功添加评论: ID=${comment.id}`, "githubCreateIssueComment");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreateIssueComment", e.status);
  }
}

async function githubUpdateIssue(params: any) {
  const { owner, repo, number, title, body, state, labels } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubUpdateIssue");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubUpdateIssue");

  try {
    const payload: any = {};
    if (title !== undefined) payload.title = title;
    if (body !== undefined) payload.body = body;
    if (state !== undefined) payload.state = state;
    if (labels !== undefined) payload.labels = labels;
    const issue = await githubApiRequest(`/repos/${owner}/${repo}/issues/${number}`, { method: "PATCH", body: JSON.stringify(payload) });
    return ok({ number: issue.number, state: issue.state, title: issue.title }, `成功更新 Issue #${issue.number}: [${issue.state}] ${issue.title}`, "githubUpdateIssue");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubUpdateIssue", e.status);
  }
}

async function githubListIssueComments(params: any) {
  const { owner, repo, number, per_page = 30 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListIssueComments");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubListIssueComments");

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=${per_page}`);
    const items = data.map((c: any) => ({ id: c.id, author: c.user?.login, body: c.body, createdAt: c.created_at }));
    return ok(items, `${owner}/${repo} #${number} 的评论(${items.length} 个)`, "githubListIssueComments");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListIssueComments", e.status);
  }
}

async function githubSearchIssues(params: any) {
  const { query, per_page = 10 } = params;
  const v = validate(validators.validateQuery(query));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubSearchIssues");

  try {
    const data = await githubApiRequest(`/search/issues?q=${encodeURIComponent(query)}&per_page=${per_page}`);
    const items = (data.items || []).map((i: any) => ({ number: i.number, title: i.title, state: i.state, type: i.pull_request ? "pull_request" : "issue", url: i.html_url, repo: i.repository_url?.replace("https://api.github.com/repos/", "") }));
    return ok({ total: data.total_count, items }, `找到 ${data.total_count} 个 Issues/PRs(显示${items.length} 个)`, "githubSearchIssues");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubSearchIssues", e.status);
  }
}

// ====== pull-request ======

async function githubListPulls(params: any) {
  const { owner, repo, state = "open", per_page = 10 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListPulls");

  try {
    const pulls = await githubApiRequest(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${per_page}`);
    const items = pulls.map((pr: any) => ({ number: pr.number, title: pr.title, state: pr.state, author: pr.user.login, branch: `${pr.head.ref} → ${pr.base.ref}`, draft: pr.draft, createdAt: pr.created_at }));
    return ok(items, `${owner}/${repo} 的 ${state} PRs (${items.length} 个)`, "githubListPulls");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListPulls", e.status);
  }
}

async function githubGetPull(params: any) {
  const { owner, repo, number } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetPull");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubGetPull");

  try {
    const pr = await githubApiRequest(`/repos/${owner}/${repo}/pulls/${number}`);
    return ok({ number: pr.number, title: pr.title, state: pr.state, author: pr.user.login, body: pr.body, branch: `${pr.head.ref} → ${pr.base.ref}`, draft: pr.draft, commits: pr.commits, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, merged: pr.merged, mergeable: pr.mergeable, url: pr.html_url, createdAt: pr.created_at, updatedAt: pr.updated_at }, `PR #${pr.number}: ${pr.title} (${pr.state})`, "githubGetPull");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetPull", e.status);
  }
}

async function githubCreatePullRequest(params: any) {
  const { owner, repo, title, head, base = "main", body, draft = false } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreatePullRequest");
  if (!title || !head) return err("Validation", { message: "请提供 title 和 head", suggestion: "" }, "githubCreatePullRequest");

  try {
    const payload: any = { title, head, base, draft };
    if (body !== undefined) payload.body = body;
    const pr = await githubApiRequest(`/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify(payload) });
    return ok({ number: pr.number, url: pr.html_url, title: pr.title }, `成功创建 PR #${pr.number}: ${pr.title}`, "githubCreatePullRequest");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreatePullRequest", e.status);
  }
}

async function githubMergePullRequest(params: any) {
  const { owner, repo, number, merge_method = "squash", commit_title, commit_message } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubMergePullRequest");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubMergePullRequest");

  try {
    const payload: any = { merge_method };
    if (commit_title) payload.commit_title = commit_title;
    if (commit_message) payload.commit_message = commit_message;
    const result = await githubApiRequest(`/repos/${owner}/${repo}/pulls/${number}/merge`, { method: "PUT", body: JSON.stringify(payload) });
    return ok({ sha: result.sha, message: result.message }, `成功合并 PR #${number} (commit: ${result.sha?.substring(0, 7)})`, "githubMergePullRequest");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubMergePullRequest", e.status);
  }
}

async function githubGetPullRequestFiles(params: any) {
  const { owner, repo, number, per_page = 100 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubGetPullRequestFiles");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubGetPullRequestFiles");

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=${per_page}`);
    const items = data.map((f: any) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes, patch: f.patch }));
    const totalAdditions = items.reduce((sum: number, f: any) => sum + f.additions, 0);
    const totalDeletions = items.reduce((sum: number, f: any) => sum + f.deletions, 0);
    return ok({ files: items, totalAdditions, totalDeletions, fileCount: items.length }, `PR #${number} 变更文件 (${items.length} 个),${totalAdditions}/-${totalDeletions}`, "githubGetPullRequestFiles");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubGetPullRequestFiles", e.status);
  }
}

async function githubCreatePullRequestReview(params: any) {
  const { owner, repo, number, event, body } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreatePullRequestReview");
  const n = validate(validators.validateNumber(number));
  if (n) return err("Validation", { message: n, suggestion: "" }, "githubCreatePullRequestReview");
  if (!event) return err("Validation", { message: "请提供 event 参数", suggestion: "" }, "githubCreatePullRequestReview");
  if ((event === "REQUEST_CHANGES" || event === "COMMENT") && !body) {
    return err("Validation", { message: "REQUEST_CHANGES 或 COMMENT 必须提供 body", suggestion: "" }, "githubCreatePullRequestReview");
  }

  try {
    const payload: any = { event };
    if (body !== undefined) payload.body = body;
    const data = await githubApiRequest(`/repos/${owner}/${repo}/pulls/${number}/reviews`, { method: "POST", body: JSON.stringify(payload) });
    return ok({ id: data.id, state: data.state, html_url: data.html_url }, `Review 提交成功: ?{data.state}`, "githubCreatePullRequestReview");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreatePullRequestReview", e.status);
  }
}

// ====== file ======

async function githubCreateOrUpdateFile(params: any) {
  const { owner, repo, path, content, message, branch = "main", sha } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreateOrUpdateFile");
  if (!path || content === undefined || !message) {
    return err("Validation", { message: "请提供 path、content 和 message", suggestion: "" }, "githubCreateOrUpdateFile");
  }

  try {
    const payload: any = { message, content: Buffer.from(content).toString("base64"), branch };
    if (sha) payload.sha = sha;
    const data = await githubApiRequest(`/repos/${owner}/${repo}/contents/${encodeFilePath(path)}`, { method: "PUT", body: JSON.stringify(payload) });
    return ok({ path: data.content?.path, sha: data.content?.sha, url: data.content?.html_url }, `成功提交文件: ${path} (commit: ${data.commit?.sha?.substring(0, 7)})`, "githubCreateOrUpdateFile");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreateOrUpdateFile", e.status);
  }
}

async function githubDeleteFile(params: any) {
  const { owner, repo, path, message, sha, branch = "main" } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubDeleteFile");
  if (!path || !message || !sha) {
    return err("Validation", { message: "请提供 path、message 和 sha", suggestion: "" }, "githubDeleteFile");
  }

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}/contents/${encodeFilePath(path)}`, { method: "DELETE", body: JSON.stringify({ message, sha, branch }) });
    return ok({ commit: data.commit?.sha }, `成功删除文件: ${path}`, "githubDeleteFile");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubDeleteFile", e.status);
  }
}

// ====== branch ======

async function githubCreateBranch(params: any) {
  const { owner, repo, branch, from_branch = "main" } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubCreateBranch");
  if (!branch) return err("Validation", { message: "请提供分支名(branch)", suggestion: "" }, "githubCreateBranch");

  try {
    const baseBranch = await githubApiRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeRefPath(from_branch)}`);
    const sha = baseBranch.object.sha;
    const result = await githubApiRequest(`/repos/${owner}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
    return ok({ ref: result.ref }, `成功创建分支: ${branch}`, "githubCreateBranch");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubCreateBranch", e.status);
  }
}

async function githubDeleteBranch(params: any) {
  const { owner, repo, branch } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubDeleteBranch");
  if (!branch) return err("Validation", { message: "请提供分支名(branch)", suggestion: "" }, "githubDeleteBranch");

  try {
    await githubApiRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeRefPath(branch)}`, { method: "DELETE" });
    return ok({}, `成功删除分支: ${branch}`, "githubDeleteBranch");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubDeleteBranch", e.status);
  }
}

async function githubForkRepo(params: any) {
  const { owner, repo, organization, name } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubForkRepo");

  try {
    const payload: any = {};
    if (organization) payload.organization = organization;
    if (name) payload.name = name;
    const result = await githubApiRequest(`/repos/${owner}/${repo}/forks`, { method: "POST", body: JSON.stringify(payload) });
    return ok({ full_name: result.full_name, url: result.html_url }, `成功 Fork 仓库: ${result.full_name}`, "githubForkRepo");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubForkRepo", e.status);
  }
}

async function githubListBranches(params: any) {
  const { owner, repo, per_page = 30 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListBranches");

  try {
    const branches = await githubApiRequest(`/repos/${owner}/${repo}/branches?per_page=${per_page}`);
    const items = branches.map((b: any) => ({ name: b.name, protected: b.protected }));
    return ok(items, `${owner}/${repo} 的分支(${items.length} 个)`, "githubListBranches");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListBranches", e.status);
  }
}

// ====== workflow ======

async function githubListWorkflows(params: any) {
  const { owner, repo } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListWorkflows");

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}/actions/workflows`);
    const items = (data.workflows || []).map((wf: any) => ({ id: wf.id, name: wf.name, path: wf.path, state: wf.state, url: wf.html_url }));
    return ok(items, `${owner}/${repo} 的工作流 (${items.length} 个)`, "githubListWorkflows");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListWorkflows", e.status);
  }
}

async function githubListWorkflowRuns(params: any) {
  const { owner, repo, per_page = 10 } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubListWorkflowRuns");

  try {
    const data = await githubApiRequest(`/repos/${owner}/${repo}/actions/runs?per_page=${per_page}`);
    const items = (data.workflow_runs || []).map((run: any) => ({ id: run.id, name: run.name, branch: run.head_branch, status: run.status, conclusion: run.conclusion, event: run.event, runNumber: run.run_number, url: run.html_url, createdAt: run.created_at }));
    return ok(items, `${owner}/${repo} 的运行记录(${items.length} 个)`, "githubListWorkflowRuns");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubListWorkflowRuns", e.status);
  }
}

async function githubTriggerWorkflow(params: any) {
  const { owner, repo, workflow_id, ref = "main", inputs } = params;
  const v = validate(validators.validateOwnerRepo(owner, repo));
  if (v) return err("Validation", { message: v, suggestion: "" }, "githubTriggerWorkflow");
  if (!workflow_id) return err("Validation", { message: "请提供 workflow_id", suggestion: "" }, "githubTriggerWorkflow");

  try {
    const payload: any = { ref };
    if (inputs) payload.inputs = inputs;
    await githubApiRequest(`/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow_id)}/dispatches`, { method: "POST", body: JSON.stringify(payload) });
    return ok({}, `成功触发工作流 ${workflow_id} (${ref})`, "githubTriggerWorkflow");
  } catch (e: any) {
    const t = translateGitHubError(e.message);
    return err(e.message, t, "githubTriggerWorkflow", e.status);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 统一执行入口
// ─────────────────────────────────────────────────────────────────────────────

const toolRegistry: Record<string, (params: any) => Promise<any>> = {
  githubGetRepo,
  githubListRepoContents,
  githubGetFileContent,
  githubSearchCode,
  githubGetCommitHistory,
  githubGetReadme,
  githubCompareCommits,
  githubGetRateLimit,
  githubSearchRepos,
  githubCreateRepo,
  githubUpdateRepo,
  githubDeleteRepo,
  githubCreateRelease,
  githubGetIssues,
  githubCreateIssue,
  githubCreateIssueComment,
  githubUpdateIssue,
  githubListIssueComments,
  githubSearchIssues,
  githubListPulls,
  githubGetPull,
  githubCreatePullRequest,
  githubMergePullRequest,
  githubGetPullRequestFiles,
  githubCreatePullRequestReview,
  githubCreateOrUpdateFile,
  githubDeleteFile,
  githubCreateBranch,
  githubDeleteBranch,
  githubForkRepo,
  githubListBranches,
  githubListWorkflows,
  githubListWorkflowRuns,
  githubTriggerWorkflow,
};

/**
 * 获取所有可用的 GitHub 工具名称列表
 *
 * 前端通过此接口发现支持的 GitHub 操作,再按需调用 executeGitHubTool. 
 *
 * @returns 工具名称数组,如 ['github_create_repo', 'github_create_file', ...]
 */
export function listGitHubTools(): string[] {
  return Object.keys(toolRegistry);
}

/**
 * 执行指定的 GitHub 工具
 *
 * 所有前端 GitHub 工具调用的统一入口. 根据 toolName 从 toolRegistry 中
 * 查找对应的执行函数,传入参数并返回结果. 
 *
 * @param toolName - 工具名称,如 "github_create_repo"
 * @param params   - 工具参数,由前端根据工具定义传入
 * @returns 工具执行结果(success 为 true/false,失败时含 error 字段)
 */
export async function executeGitHubTool(toolName: string, params: any, token?: string): Promise<any> {
  if (token) setGitHubToken(token);
  const executor = toolRegistry[toolName];
  if (!executor) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
      message: `Unknown tool: ${toolName}`,
      suggestion: `Available tools: ${listGitHubTools().join(", ")}`,
      toolName,
    };
  }
  try {
    return await executor(params);
  } finally {
    if (token) setGitHubToken("");
  }
}