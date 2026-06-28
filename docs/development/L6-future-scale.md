# L6+：未来扩展（规划）

> **非 L1–L5 范围。** L1–L5 已于 2026-06-29 封板并通过 `pnpm validate` 验收。
> 本文件仅记录后续演进方向，实施前需单独开分支与验收标准。

---

## 阶段目标

在 L5 单用户本地优先架构上，向**多用户、更强搜索、媒体优化、协作工作流**演进，仍保持 Markdown 为源的核心原则。

---

## 模块清单（待实施）

| 模块 | 主题 | 优先级 | 说明 |
|---|---|---|---|
| L6-M01 | 多用户鉴权 | P1 | NextAuth / Clerk；用户表、会话隔离、RBAC |
| L6-M02 | Meilisearch | P2 | 可选替换 FTS5；`SEARCH_BACKEND=fts\|meili` 环境切换 |
| L6-M03 | WebP 上传 | P2 | `file.upload` 对 PNG/JPEG 转 WebP（sharp）；保留原 MIME 元数据 |
| L6-M04 | Agent 协作 | P3 | 多 Agent 工作流模板、子 Agent 委派、Run 可视化增强 |
| L6-M05 | 主题切换 | P3 | 深色模式 UI（CSS 变量已预留 `.dark`） |

---

## 验收标准（草案）

- [ ] 新能力均有 Vitest 或 Playwright 覆盖
- [ ] `docs/development/entities/entity-matrix.md` 同步更新
- [ ] 不破坏 `pnpm validate` 现有 26 E2E + 88 Vitest 基线
- [ ] 环境变量写入 `.env.example` 并文档化

---

## 参考

- 封板状态：`PLAN_STATUS.json`、`docs/development/README.md`
- 开发日志：`.dev-log/session-2026-06-29.md`
