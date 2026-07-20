/**
 * 审批 decision-scope 派生 / 匹配（W3 叶子模块）
 *
 * 格式：`<domain>:<verb>:<target>`
 * 匹配为字符串前缀级近似语义——不做 realpath / 环境变量展开。
 *
 * 不变量：
 * - scope 由服务端从工具名 + 关键参数派生；LLM 不可见、不可传
 * - 缺省回退 `tool:<toolName>`
 * - 通配：`fs:write:*` 覆盖任意 fs:write 目标；`git:*` 覆盖 git 全族
 */

import { getTool, listTools } from "./tools/registry.js";

export type PendingApprovalScope = {
  approvalId: string;
  scope: string;
};

export type GateBlock = {
  approvalId: string;
  scope: string;
  reason: string;
};

/** 可选：工具注册处提供的 scope 派生（LLM 不可见） */
export type DeriveScopeFn = (args: Record<string, unknown>) => string | null | undefined;

/** 路径字符串规范化（正斜杠、去重复斜杠）；不做 realpath */
export function normalizeScopePath(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  if (!s || s === ".") return ".";
  return s.replace(/\/$/, "") || ".";
}

/** fs:write 目录级前缀：文件取父目录，目录原样 */
export function directoryPrefixForWrite(rawPath: string): string {
  const p = normalizeScopePath(rawPath);
  if (p === "." || p === "/") return ".";
  const lastSlash = p.lastIndexOf("/");
  const lastSeg = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  // 含点号的末段视为文件名
  if (lastSeg.includes(".")) {
    if (lastSlash <= 0) return ".";
    return p.slice(0, lastSlash) || ".";
  }
  return p;
}

function argStr(args: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * 从工具名 + args 派生 decisionScope。
 * 优先工具注册处的 deriveScope；否则走内置表；再否则 `tool:<name>`。
 */
export function deriveDecisionScope(toolName: string, args: Record<string, unknown> = {}): string {
  const tool = getTool(toolName);
  const custom = (tool as { deriveScope?: DeriveScopeFn } | undefined)?.deriveScope?.(args);
  if (typeof custom === "string" && custom.trim()) return custom.trim();

  switch (toolName) {
    case "git_commit":
    case "git.commit":
      return `git:commit:${argStr(args, "repoId", "repoPath", "id") ?? "*"}`;
    case "git_push":
    case "git.push":
      return `git:push:${argStr(args, "repoId", "repoPath", "id") ?? "*"}`;
    case "git_pull":
    case "git.pull":
      return `git:pull:${argStr(args, "repoId", "repoPath", "id") ?? "*"}`;
    case "write_file":
    case "append_to_file":
      return `fs:write:${directoryPrefixForWrite(argStr(args, "path") ?? ".")}`;
    case "file_delete":
    case "file.delete":
    case "directory_delete":
      return `fs:delete:${normalizeScopePath(argStr(args, "path") ?? "*")}`;
    case "agent_delete":
    case "agent_delete_sub":
    case "agent.delete":
      return `agent:delete:${argStr(args, "id") ?? "*"}`;
    case "memory_delete":
    case "memory.delete":
      return `memory:delete:${argStr(args, "id") ?? "*"}`;
    case "post_delete":
    case "post.delete":
      return `post:delete:${argStr(args, "id") ?? "*"}`;
    case "skill_enable":
    case "skill_promote":
      return `skill:${toolName === "skill_enable" ? "enable" : "promote"}:${argStr(args, "name", "skillName", "id") ?? "*"}`;
    default:
      return `tool:${toolName}`;
  }
}

/**
 * 通配 / 精确匹配（双向）：
 * - 精确相等
 * - `domain:verb:*` 覆盖同 domain:verb 任意 target
 * - `domain:*` 覆盖该 domain 全族（如 git:*）
 */
export function scopesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return wildcardCovers(a, b) || wildcardCovers(b, a);
}

function wildcardCovers(pattern: string, concrete: string): boolean {
  if (!pattern.endsWith(":*")) return false;
  const prefix = pattern.slice(0, -1); // "fs:write:" 或 "git:"
  if (concrete.startsWith(prefix)) return true;
  // `git:*` 亦覆盖 `git` 本身（无 verb）——实际不会出现，保留对称
  const domainOnly = pattern.slice(0, -2);
  return concrete === domainOnly || concrete.startsWith(`${domainOnly}:`);
}

/** requiredScopes 与 pending scopes 是否相交 */
export function scopesIntersect(requiredScopes: string[], pendingScopes: string[]): boolean {
  if (requiredScopes.length === 0 || pendingScopes.length === 0) return false;
  for (const r of requiredScopes) {
    for (const p of pendingScopes) {
      if (scopesMatch(r, p)) return true;
    }
  }
  return false;
}

/** 在 pending 中找首个与 required 相交的审批；无则 null */
export function findGateBlock(
  requiredScopes: string[],
  pending: PendingApprovalScope[],
): GateBlock | null {
  if (requiredScopes.length === 0 || pending.length === 0) return null;
  for (const row of pending) {
    if (!row.scope) continue;
    for (const r of requiredScopes) {
      if (scopesMatch(r, row.scope)) {
        return {
          approvalId: row.approvalId,
          scope: row.scope,
          reason: `因审批 ${row.approvalId} 阻塞 scope ${row.scope}`,
        };
      }
    }
  }
  return null;
}

/**
 * 工作项声明 requiredScopes：按工具集静态推导粗粒度通配。
 * 例：声明了 write_file → `fs:write:*`；git_commit → `git:commit:*`；亦可用 `git:*` 覆盖全族。
 */
export function deriveRequiredScopesFromTools(tools: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tools) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    switch (name) {
      case "write_file":
      case "append_to_file":
        out.add("fs:write:*");
        break;
      case "file_delete":
      case "file.delete":
      case "directory_delete":
        out.add("fs:delete:*");
        break;
      case "git_commit":
      case "git.commit":
        out.add("git:commit:*");
        out.add("git:*");
        break;
      case "git_push":
      case "git.push":
        out.add("git:push:*");
        out.add("git:*");
        break;
      case "git_pull":
      case "git.pull":
        out.add("git:pull:*");
        out.add("git:*");
        break;
      case "agent_delete":
      case "agent_delete_sub":
      case "agent.delete":
        out.add("agent:delete:*");
        break;
      case "memory_delete":
      case "memory.delete":
        out.add("memory:delete:*");
        break;
      case "post_delete":
      case "post.delete":
        out.add("post:delete:*");
        break;
      case "skill_enable":
        out.add("skill:enable:*");
        break;
      case "skill_promote":
        out.add("skill:promote:*");
        break;
      default: {
        // destructive 且非豁免 → tool:<name>（粗粒度）
        const tool = getTool(name);
        if (tool?.destructive && !tool.approvalExempt) {
          out.add(`tool:${name}`);
        }
        break;
      }
    }
  }
  return [...out];
}

/** 去掉 native:/skill:/mcp: 前缀，便于与 registry 名对齐 */
function bareToolName(toolName: string): string {
  return String(toolName ?? "").replace(/^(native|skill|mcp):/, "").trim();
}

/** 只读工具：registry 上 reentrant=true（与可重入只读集对齐） */
export function isReadonlyTool(toolName: string): boolean {
  const bare = bareToolName(toolName);
  if (!bare) return false;
  const tool = getTool(bare) ?? getTool(toolName);
  if (tool?.reentrant === true) return true;
  // registry 未注册时的保守已知只读名（测试夹具 / tRPC 点号名）
  return (
    bare.startsWith("read_") ||
    bare.endsWith("_search") ||
    bare.endsWith("_status") ||
    bare.endsWith("_list") ||
    bare === "memory_search" ||
    bare === "list_directory" ||
    bare === "file_stat" ||
    bare === "search_files" ||
    bare === "web_search"
  );
}

/** 过滤为只读工具集（safe bypass 用） */
export function filterReadonlyTools(tools: string[]): string[] {
  return tools.filter((t) => isReadonlyTool(t));
}

/** 列出 registry 中全部 reentrant 只读 native 工具名 */
export function listReadonlyNativeToolNames(): string[] {
  return listTools("native")
    .filter((t) => t.reentrant === true)
    .map((t) => t.name);
}

/** 通知冷却：窗口内同审批不重复通知 */
export function shouldNotifyApprovalByCooldown(opts: {
  lastNotifiedAt: Date | string | null | undefined;
  cooldownMs: number;
  nowMs: number;
}): boolean {
  if (opts.cooldownMs <= 0) return true;
  if (opts.lastNotifiedAt == null) return true;
  const prevMs =
    typeof opts.lastNotifiedAt === "string"
      ? Date.parse(opts.lastNotifiedAt)
      : opts.lastNotifiedAt.getTime();
  if (!Number.isFinite(prevMs)) return true;
  return opts.nowMs - prevMs >= opts.cooldownMs;
}

/* ─── pending scope 进程内缓存（供 AsyncJobOrchestrator 同步 drain 判定） ─── */

let pendingScopeCache: PendingApprovalScope[] = [];

export function getCachedPendingApprovalScopes(): PendingApprovalScope[] {
  return pendingScopeCache;
}

export function setCachedPendingApprovalScopes(rows: PendingApprovalScope[]): void {
  pendingScopeCache = rows
    .filter((r) => typeof r.scope === "string" && r.scope.length > 0)
    .map((r) => ({ approvalId: r.approvalId, scope: r.scope }));
}

export function upsertCachedPendingScope(row: PendingApprovalScope): void {
  if (!row.scope) return;
  const idx = pendingScopeCache.findIndex((r) => r.approvalId === row.approvalId);
  if (idx >= 0) pendingScopeCache[idx] = row;
  else pendingScopeCache.push(row);
}

export function removeCachedPendingScope(approvalId: string): void {
  pendingScopeCache = pendingScopeCache.filter((r) => r.approvalId !== approvalId);
}

export function __resetPendingScopeCacheForTests(): void {
  pendingScopeCache = [];
}
