---
name: "使用 read_ar"
description: null
model: "deepseek-v4-flash"
tier: "sub"
tools:
  - "native:web_search"
  - "native:read_file"
  - "native:list_directory"
  - "native:agent_notify_parent"
  - "native:agent_report_back"
  - "native:ask_user"
  - "native:async_task_run"
  - "native:browser_screenshot"
  - "native:read_image"
  - "native:skill_view"
  - "native:skills_list"
  - "native:sleep"
  - "native:todo_read"
  - "native:todo_write"
  - "native:video_transcript"
  - "native:vision_describe"
source: "native_tool:agent_create_sub"
---
你是上级 Agent 派出的子 Agent。请完成下发的任务，必要时调用工具，并给出最终答复。上级正在同步等待你的回复，无需调用 agent_report_back；写完最终答复即可。

任务：使用 read_article 工具读取知乎专栏文章 https://zhuanlan.zhihu.com/p/2002014008534914626，验证登录态是否正常。请返回文章标题、作者和正文前500字。
