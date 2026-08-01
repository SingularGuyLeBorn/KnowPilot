---
name: "agent-orchestration"
description: "agent-orchestration"
icon: "Sparkles"
trigger: "/agent-orchestration"
enabled: true
kind: procedural
---
# agent-orchestration — 子 Agent 编排与异步任务模式

## 何时加载
- 复杂任务需拆解为多个并行/串行子任务
- 需要后台长跑任务（不阻塞主会话）
- 多 Agent 协作、结果聚合、进度汇报

## 核心原则
1. **编排优先**：能派子 Agent 做的，不要自己一头扎进去
2. **隔离铁律**：只能看子 Agent 状态（agent_inspect），看不到消息内容——结果只能经 `agent_report_back` 投递到异步结果队列
3. **工具分工**：
   - `native:spawn_subagent` — 派生子 Agent（跑 LLL、可用工具、需等结果） → `waitForResult=false` 立即 return，结果经 `agent_report_back` 自动投递
   - `native:async_task_run` — 纯工具后台任务（不跑 LLM、不派生子 Agent） → 用 `async_task_status` 轮询
4. **向上汇报**：用 `agent_report_back` 向父 Agent/超级 Agent 汇报；过程通知用 `agent_notify_parent`

## 典型模式

### 模式 A：并行子 Agent（Map-Reduce）
```typescript
// 1. 派生 N 个子 Agent 并行
const subagents = topics.map(t => spawn_subagent({
  task: `深度调研：${t}`,
  waitForResult: false
}));

// 2. 主会话立即 return，告知用户「已派 N 个子 Agent」
// 3. 结果会异步以 agent_report_back 气泡形式出现在后续轮次
```

### 模式 B：串行 Pipeline（链式）
```typescript
// 子 Agent A 产出 → 交给子 Agent B → 最终汇报
spawn_subagent({ task: "阶段1：收集原始资料", waitForResult: false })
// 结果到达后，本 Agent 再派阶段2
```

### 模式 C：后台纯工具任务（async_task_run）
```typescript
// 适合：批量下载、格式转换、大量文件处理、定时轮询
async_task_run({
  steps: [
    { tool: "web_search", args: {...} },
    { tool: "read_article", args: {...} },
    { tool: "write_file", args: {...} }
  ]
})
// 用 async_task_status 轮询进度
```

## 常见坑与对策
| 现象 | 原因 | 对策 |
|------|------|------|
| 派生子 Agent 后继续调用工具 | 未立即 return | `waitForResult=false` 后**必须**结束本轮（return） |
| 试图读取子 Agent 消息 | 违反隔离铁律 | 只能等 `agent_report_back` 投递的结果气泡 |
| 用 `async_task_run` 跑 LLM | 工具不支持 | 需 LLM 推理的必须用 `spawn_subagent` |
| 子 Agent 失败无感知 | 未检查投递结果 | 每轮开头检查异步结果队列，失败时重派或降级 |
| 并发过多导致限流 | 无节流 | 并发 ≤ 3；大批量分批派发 |

## 与其它 Skill 协作
- `deep-research`：子 Agent 做并行广搜/精读，主 Agent 做交叉验证与成稿
- `knowledge-garden`：子 Agent 并行写多篇文章，主 Agent 做首页目录与健康检查
- `algo-viz` / `remotion-code-motion-explainer`：子 Agent 生成分镜/代码，主 Agent 组装渲染

## 实战模式：后台任务 + 结果复盘（Background Task Review）
**触发场景**：用 `async_task_run` 跑长链路纯工具任务（批量抓取、格式转换、文件处理），随后需人工/模型复盘结果。

### 标准链路
```typescript
// 1. 发起后台任务（不阻塞主会话）
const taskId = async_task_run({
  steps: [
    { tool: "web_search", args: { query: "..." } },
    { tool: "read_article", args: { url: "...", offset: 0 } },
    { tool: "read_article", args: { url: "...", offset: 5000 } },
    { tool: "write_file", args: { path: "workspace/raw.md", content: "..." } }
  ]
});

// 2. 主会话可继续别的事，或立即 return 告知用户「后台任务已启动，ID: ${taskId}」

// 3. 后续轮次：用 async_task_status 轮询，或等任务自动投递结果
//    结果到达后 → read_file 读产物 → 复盘/摘要/入库
```

### 复盘检查清单（结果到达后必做）
- [ ] `async_task_status` 确认 `status: "completed"` / `failed`
- [ ] `read_file` 读取产物（`workspace/` 下或指定路径）
- [ ] 关键指标抽取：成功条数、失败条数、耗时、Token 估算
- [ ] 异常分类：网络超时 / 选择器失效 / 反爬 / 内容为空
- [ ] 决策：重跑失败项 / 补全缺失 / 直接入库 / 标记人工介入

### 常见坑
| 现象 | 原因 | 对策 |
|------|------|------|
| 任务跑完没感知 | 未轮询/未等投递 | 每轮开头检查异步结果队列；关键任务显式 `async_task_status` |
| 产物路径找不到 | `write_file` 落在子任务 Workspace | 约定产物路径；或用 `post_create` 直接入库 |
| 步骤间依赖未显式传递 | `async_task_run` 步骤间无自动上下文 | 用文件中转（写中间件 → 读中间件），或改用 `spawn_subagent` |
| 并发写同一文件冲突 | 多任务并行写同一路径 | 每任务独享输出路径（含 taskId），汇总阶段再合并 |

## 质量检查清单（派生前自检）
- [ ] 任务可拆解为独立子任务（输入/输出明确）
- [ ] 子任务描述含：目标、约束、输出格式、可用工具
- [ ] 并发数 ≤ 3，或分批派发
- [ ] 已告知用户「已派 N 个子 Agent，结果稍后投递」
- [ ] 结果聚合策略已想好（去重、冲突解决、排序）
