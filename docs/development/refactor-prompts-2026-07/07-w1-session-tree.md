# 07 W1：会话树（分支 `feat/session-tree`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。
> 设计来源：pi 的 tree-structured sessions（参考实现 `tmp/references/pi`，重点读 `packages/coding-agent/docs/session-format.md`、`packages/coding-agent/src/core/session-manager.ts`）。

## 目标

KnowPilot 当前 ChatMessage 是扁平线性链，无分支、无书签。本会话树工单让用户可以：从任意历史消息分叉继续对话（分支）、在分支间切换、给节点加书签、切换时对被放弃分支自动生成摘要保留旁路上下文。

## 设计契约（已拍板，按此实现）

pi 的模型：会话存 JSONL，条目带 `id`/`parentId` 构成树，「当前叶」即游标，分支不产生新文件。KnowPilot 是 SQLite 行存储，映射如下：

### Schema（prisma db push + 一次性回填脚本）

- `ChatMessage` 加 `parentId String?`（指向前一条消息的 id；首条为 null）+ 索引 `@@index([sessionId, parentId])`。
- `ChatMessage` 加 `label String?`（书签，可空）。
- `ChatMessage.kind` 扩展枚举值 `branch_summary`（分支摘要消息，role=system，不进 LLM 上下文除非位于活跃路径且被标记为注入——见下）。
- `ChatSession` 加 `activeLeafId String?`（当前叶消息 id，游标）。
- 回填脚本（`apps/server/src/scripts/migrate-chat-tree.ts`，执行完即删）：按 sessionId 分组、按 createdAt 排序把 parentId 串成链，activeLeafId=最后一条消息 id。存量会话 = 单链树。

### 服务端

- **写入点**：所有新建 ChatMessage 的路径（agentStream done 落库、injectUserMessages、用户发消息、系统消息）必须填 parentId=当前 activeLeafId，并把 session.activeLeafId 推进到新消息——**同事务**（消息 create + session update 一个 $transaction）。
- **活跃路径读取**：`buildSessionHistory`/chatHistory 重建从「取 session 全部消息按时间排序」改为「从 activeLeafId 沿 parentId 回溯到根，再反转」——活跃路径之外的分支不进 LLM 上下文。列表 API 同样按活跃路径返回（保留「查看全树」的调试参数 `tree:true`）。
- **分支切换** `chatSession.switchBranch({ sessionId, messageId })`：messageId 必须在会话内；切换 = 更新 activeLeafId 为该 messageId（后续新消息即从其分叉）；若从叶 A 切到另一分支点 B 且 A 所在旁路有新内容，**触发 branch_summary**（见下）。幂等：切到当前叶 = no-op。
- **branch_summary**：切换时对被放弃的旁路（从分叉点到旧叶的消息序列）生成摘要——复用现有 compaction 摘要管道（autoCompact 的 LLM 调用与 prompt 风格），token 预算内截取；摘要落为 kind=branch_summary 的 ChatMessage（parentId=分叉点），role=system，默认不进活跃路径上下文（它是给「切回来的人/未来浏览」看的）；若同一分叉点已有 branch_summary 且旁路无新消息则复用不重复生成。生成失败不阻断切换（warn + 跳过）。
- **书签** `chatMessage.setLabel({ messageId, label | null })`。
- tRPC：router.ts 的 chatSession/chatMessage 区加 `switchBranch`、`tree`（返回某消息的所有 children 映射或全树邻接表，供 UI 渲染分支指示）、`setLabel`。schemas.ts 补 zod。

### Web

- 消息列表：有多个 children 的节点显示分支指示（如「2 个分支 ▸」），点击弹出分支切换（调 switchBranch 后 hydrate 活跃路径）。
- 书签：消息操作菜单加「加书签/去书签」，侧栏或消息列表顶部有书签跳转列表。
- 分支摘要消息以折叠系统卡渲染（类似现有 compact 边界卡的样式，复用组件）。
- 渲染层注意：消息列表现在按活跃路径渲染；`parentId` 不进渲染关键路径（仍按顺序列表渲染，分支只是数据源切换）。
- store：useSessionMessages 的 hydrate/upsert 保持按 id 幂等；切换分支 = 服务端切换 + 重新 hydrate（显式触发，不加隐式 effect 联动）。

### 与既有机制的边界

- **autoCompact**：压缩只作用于活跃路径（现状逻辑基本不变，输入从「全部消息」变「活跃路径」）；contextSummary 与活跃叶无耦合。
- **resume/paused**：activeLeafId 随会话状态持久化，恢复会话照常从叶继续。
- **FTS**：仍索引全部消息（不分支过滤），不变。
- **导出/trace**：导出当前活跃路径（与「用户所见」一致）。

## 测试要求

- server：`__tests__/chatTree.test.ts`——
  - 回填脚本：存量线性消息正确成链、activeLeaf 正确；
  - 写入点：连续发消息 parentId 链正确、activeLeafId 推进、并发两路写入（如用户消息与 inject）不断链（同事务断言）；
  - 活跃路径：分叉后 buildSessionHistory 只含活跃分支；
  - switchBranch：幂等/越权（他会话 messageId 拒绝）/分支摘要生成（mock LLM）与复用（同分叉点不重复生成）；
  - branch_summary 不进 LLM 上下文（断言构建的 llmMessages 不含其 content）。
- web：`lib/__tests__/` 或组件测试——分支指示渲染、切换后 hydrate 调用、书签 CRUD。
- 既有 chatHistory.test.ts、trpc.test.ts 不回归。
- 跑：`pnpm --filter @knowpilot/server test`、`pnpm --filter @knowpilot/web test`、`pnpm lint` 全绿。

## 验收清单

- [ ] schema + 回填脚本 + db push
- [ ] 写入点全仓清查（grep 所有 message.create 调用点）parentId/activeLeafId 同事务推进
- [ ] 活跃路径读取全链路（LLM 上下文构建、列表 API、导出）
- [ ] switchBranch/tree/setLabel tRPC + web UI（分支指示/切换/书签/摘要卡）
- [ ] 负向测试：分叉注入消息落到正确分支；切换中并发新消息不断链
- [ ] lint + test 全绿，合并入 master；AGENTS.md 更新；design-decisions.md 记录「分支摘要默认不进上下文」等权衡

## 红线

- 不做 pi 的 /fork（跨文件复制会话）、/clone、HTML 导出增强——本工单只要树+切换+书签+摘要。
- 不改变既有线性会话的任何对外行为（不分叉的用户零感知）。
- 摘要复用现有 compaction 管道，不新造摘要服务。
