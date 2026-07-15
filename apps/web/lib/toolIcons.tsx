"use client";

import { createElement } from "react";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  BookMarked,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Cable,
  CircleDot,
  CircleX,
  Clock,
  Copy,
  Database,
  Download,
  Eraser,
  Eye,
  FileDiff,
  FileEdit,
  FilePlus,
  FileSearch,
  FileText,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Gauge,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestArrow,
  Github,
  Globe,
  HardDrive,
  Key,
  Library,
  List,
  ListTodo,
  Mail,
  MessageSquare,
  Minimize2,
  Network,
  Newspaper,
  Play,
  Plug,
  Puzzle,
  RefreshCw,
  Reply,
  Rocket,
  RotateCcw,
  Rss,
  ScanSearch,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Table,
  Terminal,
  Trash2,
  Upload,
  UserPlus,
  Wand2,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolIconStatus = "running" | "done" | "error" | "idle";

/** 去掉 skill__ / mcp__ 前缀 */
export function normalizeToolBaseName(toolName: string): string {
  return toolName.replace(/^skill__/, "").replace(/^mcp__/, "");
}

/** 全部 native 工具 + 时间线伪工具 — 逐一映射（与 TOOL_HANDLERS 对齐） */
const EXACT_TOOL_ICONS: Record<string, LucideIcon> = {
  __context_compact__: Gauge,
  __thinking__: Sparkles,
  __content__: MessageSquare,
  __reflection__: ShieldCheck,

  web_search: Search,
  read_article: Newspaper,
  scrape_web_page: Globe,
  rss_fetch: Rss,
  rss_draft_posts: FilePlus,
  capture_zhihu_login: Globe,
  browser_login_status: Shield,

  read_file: FileText,
  write_file: FileEdit,
  append_to_file: FilePlus,
  file_copy: Copy,
  file_move: ArrowRightLeft,
  file_rename: FileEdit,
  file_delete: Trash2,
  file_stat: HardDrive,
  search_files: FileSearch,
  list_directory: FolderOpen,
  directory_create: FolderPlus,
  directory_delete: Trash2,

  post_create: FilePlus,
  post_update: FileEdit,
  post_delete: Trash2,

  memory_create: Brain,
  memory_search: ScanSearch,
  memory_delete: Eraser,

  git_branch: GitBranch,
  git_checkout: GitBranchPlus,
  git_clone: Download,
  git_status: Activity,
  git_log: GitCommitHorizontal,
  git_diff: FileDiff,
  git_commit: GitCommitHorizontal,
  git_pull: ArrowDownToLine,
  git_push: ArrowUpFromLine,

  yuque_get_doc: BookOpen,
  yuque_list_books: Library,
  yuque_get_book_toc: List,
  yuque_create_doc: FilePlus,
  yuque_update_doc: FileEdit,
  yuque_delete_doc: Trash2,
  yuque_list_repos: FolderOpen,
  yuque_list_docs: FileText,
  yuque_create_doc_v2: FilePlus,
  yuque_update_doc_v2: FileEdit,
  yuque_delete_doc_v2: Trash2,

  github_search_repos: Search,
  github_get_repo: FolderGit2,
  github_create_repo: FolderPlus,
  github_update_repo: Settings,
  github_get_file: FileText,
  github_create_file: FilePlus,
  github_update_file: FileEdit,
  github_delete_file: Trash2,
  github_list_issues: CircleDot,
  github_get_issue: CircleDot,
  github_create_issue: FilePlus,
  github_update_issue: FileEdit,
  github_list_pull_requests: GitPullRequest,
  github_get_pull_request: GitPullRequest,
  github_create_pull_request: GitPullRequestArrow,
  github_list_branches: GitBranch,
  github_get_branch: GitBranch,
  github_create_branch: GitBranchPlus,
  github_list_workflows: Workflow,
  github_trigger_workflow: Play,
  github_create_release: Rocket,
  github_tool: Github,

  feishu_send_text: MessageSquare,
  feishu_send_message: Send,
  feishu_get_doc: FileText,
  feishu_create_doc: FilePlus,
  feishu_search_docs: Search,
  feishu_get_wiki_space: BookOpen,
  feishu_get_wiki_nodes: FolderTree,
  feishu_create_spreadsheet: Table,
  feishu_append_spreadsheet_values: Table,
  feishu_token_status: Shield,
  feishu_refresh_token: RefreshCw,

  invoke_api: Webhook,
  spawn_subagent: Network,
  async_task_run: Play,
  async_task_status: Activity,
  async_task_cancel: CircleX,
  task_run: ListTodo,

  run_shell: Terminal,
  sleep: Clock,
  wait: Clock,

  session_clear: RotateCcw,
  session_rotate: RefreshCw,
  session_compact: Minimize2,

  agent_create: UserPlus,
  agent_update: Settings,
  agent_delete: Trash2,
  agent_inspect: Eye,
  agent_send_message: Send,
  agent_report_back: Reply,
  agent_create_sub: Bot,

  workspace_create: FolderPlus,
  workspace_archive: Archive,

  send_email: Mail,
  free_api_keys_list: Key,
  free_api_keys_fetch: Upload,

  skill_discover: Search,
  skill_promote: Upload,
  optimize_agent_prompt: Wand2,
  generate_skill_from_experience: Sparkles,
};

const SKILL_ICON_POOL: LucideIcon[] = [
  Puzzle,
  Wand2,
  Sparkles,
  BookMarked,
  Terminal,
  Brain,
  Search,
  FileText,
  Globe,
  Rocket,
];

const MCP_ICON_POOL: LucideIcon[] = [Plug, Server, Network, Webhook, Database, Boxes, Cable, Workflow];

function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resolveDynamicPoolIcon(toolName: string, prefix: "skill__" | "mcp__", pool: LucideIcon[]): LucideIcon {
  const suffix = toolName.slice(prefix.length).trim() || "default";
  return pool[stableHash(suffix) % pool.length]!;
}

export function resolveToolLucideIcon(toolName: string): LucideIcon {
  if (toolName.startsWith("skill__")) {
    return resolveDynamicPoolIcon(toolName, "skill__", SKILL_ICON_POOL);
  }
  if (toolName.startsWith("mcp__")) {
    return resolveDynamicPoolIcon(toolName, "mcp__", MCP_ICON_POOL);
  }
  const base = normalizeToolBaseName(toolName);
  return EXACT_TOOL_ICONS[base] ?? Wand2;
}

export function isKnownNativeToolIcon(toolName: string): boolean {
  if (toolName.startsWith("skill__") || toolName.startsWith("mcp__")) return true;
  return normalizeToolBaseName(toolName) in EXACT_TOOL_ICONS;
}

const SPIN_KEYWORDS =
  /(?:^|_)(?:search|fetch|pull|wait|refresh|clone|discover|status|workflow|github_|git_pull|git_clone|async_task|spawn_subagent|web_search|memory_search|feishu_search|github_search)/;

const PULSE_KEYWORDS = /(?:compact|sleep|wait|shell|write|create|append|commit|push|send|email|memory_create)/;

function runningAnimationClass(base: string): string {
  if (base === "__context_compact__" || base.includes("compact")) return "animate-pulse";
  if (SPIN_KEYWORDS.test(base)) return "animate-spin";
  if (PULSE_KEYWORDS.test(base)) return "animate-pulse";
  return "animate-pulse";
}

const STATUS_COLOR: Record<ToolIconStatus, string> = {
  running: "text-[var(--kp-brand)]",
  done: "text-emerald-600",
  error: "text-red-500",
  idle: "text-[var(--kp-text-3)]",
};

export function ToolStepIcon({
  toolName,
  status,
  className,
}: {
  toolName: string;
  status: ToolIconStatus;
  className?: string;
}) {
  const base = normalizeToolBaseName(toolName);
  const Icon = resolveToolLucideIcon(toolName);
  const isRunning = status === "running";

  return (
    <span
      className={cn("relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center", className)}
      data-testid="tool-step-icon"
      data-tool={base}
      data-status={status}
    >
      {isRunning && (
        <span className="absolute inset-0 rounded-full bg-[var(--kp-brand)]/15 animate-ping" aria-hidden />
      )}
      {createElement(Icon, {
        className: cn(
          "relative h-3.5 w-3.5 transition-colors duration-300",
          STATUS_COLOR[status],
          isRunning && runningAnimationClass(base),
        ),
        "aria-hidden": true,
      })}
    </span>
  );
}

export function resolveToolDisplayIcon(toolName: string): LucideIcon {
  return resolveToolLucideIcon(toolName);
}

/** 导出供测试：native 工具图标覆盖率 */
export const NATIVE_TOOL_ICON_COUNT = Object.keys(EXACT_TOOL_ICONS).length;
