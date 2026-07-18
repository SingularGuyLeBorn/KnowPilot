/**
 * 内置工具按域分组（前端展示用，与 infra/tools/native 域大致对齐）
 */

export type NativeToolGroupId =
  | "web"
  | "fs"
  | "shell"
  | "git"
  | "memory"
  | "session"
  | "async"
  | "swarm"
  | "skills"
  | "integration"
  | "other";

export type NativeToolGroup = {
  id: NativeToolGroupId;
  label: string;
  hint: string;
};

export const NATIVE_TOOL_GROUPS: NativeToolGroup[] = [
  { id: "web", label: "网络与阅读", hint: "搜索、读网页、采集" },
  { id: "fs", label: "文件与目录", hint: "读写、搜索、目录操作" },
  { id: "shell", label: "Shell 与等待", hint: "命令执行、睡眠" },
  { id: "git", label: "Git", hint: "状态、提交、拉取推送" },
  { id: "memory", label: "记忆与文章", hint: "Memory / Post / 日记" },
  { id: "session", label: "会话", hint: "会话管理、压缩" },
  { id: "async", label: "异步任务", hint: "后台任务、定时器" },
  { id: "swarm", label: "Swarm / 子 Agent", hint: "派生子代理、消息、Workspace" },
  { id: "skills", label: "Skill 闭环", hint: "技能列表/查看/管理" },
  { id: "integration", label: "外部集成", hint: "飞书、语雀、GitHub、API" },
  { id: "other", label: "其他", hint: "未归类工具" },
];

export function groupIdForNativeTool(name: string): NativeToolGroupId {
  if (/^(web_|read_article|scrape_|rss_|browser_|capture_)/.test(name)) return "web";
  if (/^(read_file|write_file|list_directory|file_|directory_|search_files)/.test(name)) {
    return "fs";
  }
  if (/^async_task_/.test(name)) return "async";
  if (/^(run_shell|wait|sleep)$/.test(name)) return "shell";
  if (/^git_/.test(name)) return "git";
  if (/^(memory_|post_|pinned_memory)/.test(name)) return "memory";
  if (/^(session_|delete_all_chat)/.test(name)) return "session";
  if (/^(skills_|skill_manage|skill_view)/.test(name)) return "skills";
  if (
    /^(spawn_|agent_|workspace_|skill_discover|skill_promote|free_models|send_email|spawn_subagent)/.test(
      name,
    )
  ) {
    return "swarm";
  }
  if (/^(yuque_|github_|feishu_|invoke_api|task_run|ocr_)/.test(name)) return "integration";
  return "other";
}

export const NATIVE_LABELS: Record<string, string> = {
  web_search: "网页搜索",
  read_article: "读取网页文章",
  scrape_web_page: "采集网页",
  read_file: "读取文件",
  write_file: "写入文件",
  list_directory: "列出目录",
  delete_all_chat_sessions: "删除全部会话",
  file_rename: "重命名文件",
  file_move: "移动文件",
  file_copy: "复制文件",
  file_delete: "删除文件",
  file_stat: "文件元信息",
  search_files: "搜索文件内容",
  directory_create: "创建目录",
  directory_delete: "删除目录",
  post_create: "创建文章",
  post_update: "更新文章",
  post_delete: "删除文章",
  memory_create: "创建记忆",
  memory_search: "搜索记忆",
  memory_update: "更新记忆",
  memory_delete: "删除记忆",
  pinned_memory_read: "读取常驻记忆",
  pinned_memory_write: "写入常驻记忆",
  memory_daily_append: "追加日记记忆",
  memory_daily_search: "搜索日记记忆",
  git_status: "Git 状态",
  git_branch: "Git 分支",
  git_checkout: "Git 切换分支",
  git_clone: "Git 克隆",
  git_log: "Git 日志",
  git_diff: "Git 差异",
  git_commit: "Git 提交",
  git_pull: "Git 拉取",
  git_push: "Git 推送",
  task_run: "运行 Task",
  yuque_get_doc: "语雀文档",
  github_search_repos: "GitHub 搜索",
  feishu_send_text: "飞书消息",
  invoke_api: "调用后端 API",
  async_task_run: "后台异步任务",
  async_task_status: "异步任务状态",
  async_task_cancel: "取消异步任务",
  run_shell: "执行 Shell 命令",
  wait: "等待/延迟",
  sleep: "睡眠/定时器",
  spawn_subagent: "派生子 Agent",
  skills_list: "列出 Skill",
  skill_view: "查看 Skill",
  skill_manage: "管理 Skill",
  agent_notify_parent: "通知上级 Agent",
  free_models_list: "免费模型目录",
  session_compact: "压缩会话",
  session_rotate: "轮换会话",
};
