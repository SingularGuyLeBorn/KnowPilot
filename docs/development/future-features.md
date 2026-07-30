# KnowPilot 未来功能规划

> 只列**尚未做完**的项。已落地能力见 `AGENTS.md`「当前状态与近期变更」与 `design-decisions.md`。

---

## 已落地（勿再当未来项）

| 项 | 落点 |
|---|---|
| `session_rotate` + 双向血缘 + 防乱飞聚焦 + `/session-lineage` | `session.ts` / `sessionRotateLineage.ts` |
| Auto-Compact（`config.yaml` compact + `contextSummary` + 手动压缩） | `autoCompact` / ChatSession |
| 推拉结合（SSE + `uiStateNotify` + 管理页短轮询 + BC） | `uiStateNotify.ts` / `uiStateChannel.ts` |
| 队列持久化与拖拽排序（`SessionQueueItem`） | Prisma + Chat 队列 UI |
| 移动端适配 | 底栏 / Chat 叠层 / `pnpm remote` |

---

## 1. 多实例部署

> **决策（2026-07-18）**：**缓做完整多实例**。单用户本地默认 `SWARM_MODE=local` 足够。  
> 已落地底座（`SWARM_MODE=redis` 时生效）：分布式 prepare 锁、`RedisSwarmBus`、session running Redis 宣称。  
> **暂不做**：全局任务池 Redis 化、BullMQ Worker、PostgreSQL 迁移、SSE 跨实例亲和。

---

## 2. Agent 进化（Hermes 风格）— 后续

> 主仓闭环（procedural SKILL.md + list/view/manage + background review + usage/curator）**已落地**。  
> **后续**：`hermes-agent-self-evolution` DSPy/GEPA 离线进化（另立工单）。

| Hermes 模块 | 状态 |
|---|---|
| skills_list / skill_view / skill_manage / review / usage+curator | ✅ |
| DSPy/GEPA `evolve_skill` | 未做 |

---

## 3. 其他候选

- **多模态识图默认路径**：附件直走 vision（`vision_describe` 已有；可再强化默认路由）。
- **协作模式**：多用户共享 Workspace（与单用户定位冲突，低优先）。
- **插件市场**：发布/安装 Skill 与 MCP。

---

## 4. 综述对照后续项

| 优先级 | 项 | 状态 |
|---|---|---|
| P1 | 记忆检索 / attribution / 轨迹 JSONL | **已落地**；Mock 平台基准仍待 |
| P2 | 轻量 SOP / 阶段工件（Markdown 接力） | 待做 |
| P2 | 常驻层 USER.md/AGENT.md 硬预算 | **已落地** |
| P3 | MCP 远程 Streamable HTTP | **已落地** |
| P3 | 本地 side 模型（Ollama 等） | 按需 |
| — | A2A 联邦 | **不做** |

### 理念不做

- 对等群聊 Swarm、参数化记忆、容器级沙箱。
- A2A 联邦 / Agent Card 市场。
