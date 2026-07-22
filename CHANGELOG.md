# Changelog

本项目所有重要变更都会记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 记忆系统：新增 `lastAccessedAt` / `accessCount` 元数据，支持按类型差异化衰减（preference/semantic 不衰减，note/procedural 慢，episodic 常规，experience 快），被检索/注入即重置衰减
- 审批邮件：AgentMail webhook 支持邮件回复审批，第一行 `APPROVE` / `REJECT` 自动决策并执行；审批通知记录 `lastNotifiedMessageId` / `lastNotifiedThreadId`
- 邮件主题统一：审批 = `[KnowPilot 待审批]`，ask_user = `[KnowPilot 需回复]`，send_email = `[KnowPilot 通知]`
- Chat UI：右下角「回到底部」浮动按钮，回底后自动隐藏
- 控制台视觉升级：`kp-card-premium` / `kp-badge` / `kp-stat-number` / `kp-table` / `kp-progress` / `kp-lift` 设计系统工具类

### Fixed
- Chat 刷新丢回复：SessionStreamHub 不再重放 `message_upserted`，no-op upsert 跳过 `tryCommitAfterAssistant`，防止 stale 重放误标 in-flight
- assistant 落库后使用 `persistedCreatedAt` 推送 `message_upserted`

### Changed
- README 重写：删除 71 个命名候选，更新为当前真实状态（L1-L5 已完成，列出 v8-v10 / W1-W16 / Chat UI / 记忆系统 / 审批邮件等近期重点）
- Dashboard / Agents / Approvals / Runs 页面应用新设计系统

## [0.1.0] - 2026-07-21

### Added
- L1-L5 全部落地
- PR-1 ~ PR-6 + W1 ~ W5 重构套件合入 master
- v8 全局任务池、v9 投递可靠性、v10 可重入与续跑
- W1-W12 / v4 / v7 既有功能（见 AGENTS.md）
