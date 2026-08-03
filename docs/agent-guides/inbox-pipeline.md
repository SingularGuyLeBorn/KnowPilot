# Agent 知识 Inbox 流程

整理截图、知乎收藏、小红书点赞/收藏、B 站收藏、微信公众号链接时走 Inbox 管道。

## 推荐流程

1. **先登录**：不确定登录态时用 `platform_login`。
2. **只拉列表**：`inbox_start_platform_sync`（`fetchContent=false`）只拉标题/封面/摘要，后台任务不堵对话。然后用 `inbox_platform_sync_status` 跟踪进度。
3. **分批补正文**：要正文时用 `inbox_enrich`（`maxItems=8~15`）分批慢补；跳过已有、条间自动间隔、撞风控停。单日建议累计 ≤40，隔几小时再跑下一轮。
4. **蒸馏入 knowledge**：`inbox_list` → `inbox_distill` 落 knowledge 草稿。

## 铁律

- **禁止**对全量收藏一次 `fetchContent=true`（易风控）；列表与正文必须拆开。
- `inbox_sync_*`：同步执行单平台（会堵对话，仅小范围试跑）。
- 用户说「同步收藏」→ 列表同步；说「要正文/内容」→ `inbox_enrich` 多轮；先登录、再列表、再正文、再蒸馏。
