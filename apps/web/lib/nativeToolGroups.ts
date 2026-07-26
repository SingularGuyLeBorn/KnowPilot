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
  if (/^(web_|read_article|scrape_|rss_|browser_|scroll_screenshot|save_webpage|vision_describe|video_transcript|read_image)/.test(name)) {
    return "web";
  }
  if (/^(read_file|write_file|list_directory|file_|directory_|search_files)/.test(name)) {
    return "fs";
  }
  if (/^async_task_/.test(name)) return "async";
  if (/^(run_shell|wait|sleep)$/.test(name)) return "shell";
  if (/^git_/.test(name)) return "git";
  if (/^(memory_|post_|pinned_memory|todo_)/.test(name)) return "memory";
  if (/^session_/.test(name)) return "session";
  if (/^(skills_|skill_manage|skill_view|skill_discover|skill_enable|skill_promote)/.test(name)) {
    return "skills";
  }
  if (
    /^(spawn_|agent_|workspace_|free_models|free_api_keys|send_email|ask_user|swarm_)/.test(name)
  ) {
    return "swarm";
  }
  if (
    /^(yuque_|github_|feishu_|task_run|ocr_|platform_login|browser_login|coze_|dify_|tikhub_)/.test(
      name,
    )
  ) {
    return "integration";
  }
  return "other";
}

export const NATIVE_LABELS: Record<string, string> = {
  web_search: "网页搜索",
  rss_fetch: "抓取 RSS",
  rss_draft_posts: "RSS 转文章草稿",
  read_article: "读取网页文章",
  scrape_web_page: "采集网页",
  browser_screenshot: "网页截图",
  scroll_screenshot: "滚动截图",
  save_webpage: "保存网页到本地",
  read_image: "识别图片文字",
  vision_describe: "视觉理解描述",
  video_transcript: "视频转文字",
  read_file: "读取文件",
  write_file: "写入文件",
  append_to_file: "追加文件",
  list_directory: "列出目录",
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
  post_list: "列出文章",
  memory_create: "创建记忆",
  memory_search: "搜索记忆",
  memory_update: "更新记忆",
  memory_delete: "删除记忆",
  pinned_memory_read: "读取常驻记忆",
  pinned_memory_write: "写入常驻记忆",
  memory_daily_append: "追加日记记忆",
  memory_daily_search: "搜索日记记忆",
  todo_write: "写入待办",
  todo_read: "读取待办",
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
  yuque_get_doc: "语雀读文档",
  yuque_list_books: "语雀列知识库",
  yuque_get_book_toc: "语雀知识库目录",
  yuque_create_book: "语雀创建知识库",
  yuque_update_book: "语雀更新知识库",
  yuque_delete_book: "语雀删除知识库",
  yuque_create_doc: "语雀创建文档",
  yuque_update_doc: "语雀更新文档",
  yuque_delete_doc: "语雀删除文档",
  yuque_session_status: "语雀登录态",
  yuque_list_repos: "语雀列仓库",
  yuque_create_repo: "语雀创建仓库",
  yuque_update_repo: "语雀更新仓库",
  yuque_delete_repo: "语雀删除仓库",
  yuque_list_docs: "语雀列文档",
  yuque_create_doc_v2: "语雀创建文档 v2",
  yuque_update_doc_v2: "语雀更新文档 v2",
  yuque_delete_doc_v2: "语雀删除文档 v2",
  platform_login: "平台登录捕获",
  browser_login_status: "登录态检查",
  github_search_repos: "GitHub 搜索仓库",
  github_get_repo: "GitHub 仓库详情",
  github_create_repo: "GitHub 创建仓库",
  github_update_repo: "GitHub 更新仓库",
  github_delete_repo: "GitHub 删除仓库",
  github_get_file: "GitHub 读文件",
  github_create_file: "GitHub 写文件",
  github_update_file: "GitHub 更新文件",
  github_delete_file: "GitHub 删除文件",
  github_list_issues: "GitHub 列 Issue",
  github_get_issue: "GitHub Issue 详情",
  github_create_issue: "GitHub 创建 Issue",
  github_update_issue: "GitHub 更新 Issue",
  github_create_issue_comment: "GitHub Issue 评论",
  github_list_pull_requests: "GitHub 列 PR",
  github_get_pull_request: "GitHub PR 详情",
  github_create_pull_request: "GitHub 创建 PR",
  github_update_pull_request: "GitHub 更新 PR",
  github_merge_pull_request: "GitHub 合并 PR",
  github_list_branches: "GitHub 列分支",
  github_get_branch: "GitHub 分支详情",
  github_create_branch: "GitHub 创建分支",
  github_delete_branch: "GitHub 删除分支",
  github_list_workflows: "GitHub 列工作流",
  github_trigger_workflow: "GitHub 触发工作流",
  github_create_release: "GitHub 创建 Release",
  github_tool: "GitHub 通用调用",
  feishu_send_text: "飞书发文本",
  feishu_send_message: "飞书发消息",
  feishu_get_doc: "飞书读文档",
  feishu_create_doc: "飞书创建文档",
  feishu_update_doc: "飞书更新文档",
  feishu_append_doc_text: "飞书追加文本",
  feishu_append_doc_blocks: "飞书追加块",
  feishu_delete_doc: "飞书删除文档",
  feishu_search_docs: "飞书搜索文档",
  feishu_list_permission_members: "飞书列权限成员",
  feishu_add_permission_member: "飞书加权限成员",
  feishu_update_permission_member: "飞书改权限成员",
  feishu_remove_permission_member: "飞书删权限成员",
  feishu_get_permission_public: "飞书读公开权限",
  feishu_update_permission_public: "飞书改公开权限",
  feishu_lookup_user: "飞书查用户",
  feishu_add_collaborator_by_contact: "飞书按联系人加协作者",
  feishu_get_wiki_space: "飞书读知识空间",
  feishu_get_wiki_nodes: "飞书列 Wiki 节点",
  feishu_create_wiki_node: "飞书创建 Wiki 节点",
  feishu_create_spreadsheet: "飞书创建表格",
  feishu_append_spreadsheet_values: "飞书追加表格值",
  feishu_token_status: "飞书 Token 状态",
  feishu_refresh_token: "飞书刷新 Token",
  feishu_authorize: "飞书授权登录",
  feishu_list_doc_whiteboards: "飞书列画板",
  feishu_list_whiteboard_nodes: "飞书列画板节点",
  feishu_create_whiteboard_nodes: "飞书创建画板节点",
  feishu_whiteboard_from_diagram: "飞书从图表建画板",
  feishu_delete_whiteboard_nodes: "飞书删画板节点",
  feishu_get_whiteboard_theme: "飞书读画板主题",
  feishu_update_whiteboard_theme: "飞书改画板主题",
  ask_user: "询问用户",
  send_email: "发送邮件",
  async_task_run: "后台异步任务",
  async_task_status: "异步任务状态",
  async_task_cancel: "取消异步任务",
  run_shell: "执行 Shell 命令",
  wait: "等待/延迟",
  sleep: "睡眠/定时器",
  spawn_subagent: "派生子 Agent",
  agent_create: "创建 Agent",
  agent_update: "更新 Agent",
  agent_delete: "删除 Agent",
  agent_create_sub: "创建子 Agent",
  agent_update_sub: "更新子 Agent",
  agent_delete_sub: "删除子 Agent",
  agent_inspect: "查看 Agent 状态",
  agent_send_message: "向 Agent 发消息",
  agent_report_back: "向上级回报",
  agent_notify_parent: "通知上级 Agent",
  swarm_brief: "Swarm 简报",
  workspace_create: "创建 Workspace",
  workspace_archive: "归档 Workspace",
  skills_list: "列出 Skill",
  skill_view: "查看 Skill",
  skill_manage: "管理 Skill",
  skill_discover: "发现 Skill",
  skill_enable: "启用 Skill",
  skill_promote: "晋升 Skill",
  optimize_agent_prompt: "优化 Agent 提示词",
  generate_skill_from_experience: "从经验生成 Skill",
  free_models_list: "免费模型目录",
  free_api_keys_list: "免费 API Key 列表",
  free_api_keys_fetch: "拉取免费 API Key",
  coze_chat: "Coze 对话",
  coze_workflow: "Coze 工作流",
  dify_chat: "Dify 对话",
  dify_workflow: "Dify 工作流",
  tikhub_request: "TikHub 请求",
  zhihu_openapi_search: "知乎开放平台搜索",
  zhihu_openapi_hot_list: "知乎热榜",
  zhihu_openapi_ask: "知乎直答",
  zhihu_openapi_favlists: "知乎收藏夹列表",
  zhihu_openapi_recent_collections: "知乎近期收藏",
  zhihu_openapi_favlist_contents: "知乎收藏夹内容",
  session_clear: "清空会话消息",
  session_compact: "压缩会话",
  session_rotate: "轮换会话",
  session_context_usage: "会话上下文用量",
};
