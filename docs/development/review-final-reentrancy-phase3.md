# KnowPilot v10「可重入性与跨重启续跑」阶段三复审报告

> 审查人：阶段三自审 Agent（只读）  
> 分支：`feat/reentrant-resume`（基于 `b70fe547`）  
> 审查日期：2026-07-16  
> 审查对象：P2 观察项 **S1** 的修复——`session.resume` 重复注入 `source:"system"` 续跑提示消息。

---

## 1. 审查范围

本轮复审聚焦 S1 修复的两处工作区改动：

1. `apps/server/src/infra/agentStream.ts`：将 `chatAgentStream` 中的去重守卫从 `src === "super" || src === "manager"` 扩展到包含 `src === "system"`；并确保 `system` 源在发现重复 user 消息后**不**因有 assistant 回复而提前 `return`，而是继续跑 LLM。
2. `apps/server/src/__tests__/sessionResume.test.ts`：新增 **T9** 负向回归测试——重复 `resume` 不重复注入 `source:"system"` 续跑提示消息。

为判定修复是否属于架构层根治，同步阅读了：

- `apps/server/src/services.ts` 中 `SessionService.resume` 的完整实现与不变量注释；
- `docs/development/review-final-reentrancy.md` 阶段二自审报告中的 S1 条目；
- `docs/development/concurrency.md` §8（会话手动恢复设计）。

**明确不纳入本轮审查的内容**（工作区已存在，但属于用户其他改动）：

- `content/posts/` 下 3 个 Markdown 文件的删除；
- `docs/development/开发心路历程.md` 的修改；
- 未跟踪的 `docs/development/architecture-fix-prompt-*.md` 文件。

本轮审查除最终报告外，**未修改任何源码或配置文件**。

---

## 2. 代码走查

### 2.1 `apps/server/src/infra/agentStream.ts`

`chatAgentStream` 在真正写入 user 消息前有一段去重逻辑（行 488–531）。本轮改动后：

```ts
const src = input.source ?? "user";
if ((src === "super" || src === "manager" || src === "system") && sessionId) {
  const dup = await services.prisma.chatMessage.findFirst({
    where: { sessionId, role: "user", content: prepared.messageText },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (dup) {
    prepared.skipUserCreate = true;
    if (src !== "system") {
      // 仅 super/manager 保留「已有 assistant 则直接结束」的早退路径
      ...
    }
  }
}
```

要点：

- 去重面从 `super|manager` 扩展到 `super|manager|system`，覆盖了 `SessionService.resume` 注入的 `"服务已重启，请继续完成未完成的任务"` 系统消息。
- 对 `system` 源发现重复 user 消息后，仅设置 `skipUserCreate = true`，**不**进入 assistant 早退分支。这意味着：
  - 重复 `resume` 不会写第二条系统提示气泡；
  - 服务恢复后仍会调用 LLM 推进对话（符合 C-3「续跑未完成 ReAct 轮」的语义）。
- 对 `super|manager` 的行为保持不变：若重复 user 消息后已存在 assistant 回复，仍直接 emit `done` 并 `return`，避免二次跑 LLM。

### 2.2 `apps/server/src/services.ts` `SessionService.resume`

resume 仍保持阶段二实现的架构：

- **唯一互斥点**：`prisma.chatSession.updateMany({ where: { id, status: "paused" }, data: { status: "running" } })`。并发 double-resume 只有一个调用方获得恢复权；落选方重读后若状态已是 `running` 则幂等返回。
- **系统消息注入**：`body.source = "system"`、`body.message = "（服务已重启，请继续完成未完成的任务）"`，经 `hub.startIfNotRunning(chatAgentStream)` 起流后由 `chatAgentStream` 写入。
- **终态归位**：挂在 runner 内部、`hub` 标 `completed` 之前；`done` → `active`/`completed`，`error` → `paused`，保留再次手动恢复的闭环。

S1 修复后，resume 不再依赖「只调用一次」来避免重复系统消息，而是依赖 `chatAgentStream` 自身的幂等去重。这与 resume 层的条件写互斥形成**双层防护**：外层保证同一时刻只有一个 runner，内层保证即使 runner 被重复触发也不会写入重复系统消息。

### 2.3 `apps/server/src/__tests__/sessionResume.test.ts`

T6/T7/T8 已在阶段二落地并验证；本轮新增 T9：

- **T9 构造**：
  1. 创建 `paused` 会话，第一次 `caller.session.resume({ id })`；
  2. 等待流结束，断言状态变为 `active`，且 `role=user && source=system` 消息仅 1 条；
  3. 手动把会话状态改回 `paused`，模拟「恢复后再次失败/中断」；
  4. 第二次 `resume`，等待流结束，断言 `source=system` 的 user 消息仍然只有 1 条。
- **负向断言**：测试注释明确说明「旧实现（无 system 源去重）会重复注入，本条必红」。

T9 与 T7 的区别：

- T7 验证**并发** double-resume 的互斥（只起一个 runner、只写一条系统消息）；
- T9 验证**顺序**重复 resume 的去重（两个 runner 先后运行，但系统消息不重复写入）。

两者互补，覆盖了 S1  bug 的两个触发形态。

### 2.4 `docs/development/review-final-reentrancy.md` S1 回顾

阶段二报告的 S1 根因为：

> `chatAgentStream` 在起流后首先把 `source:system` 的续跑提示写入 `ChatMessage`，然后才执行 ReAct。若执行体抛出非 abort 错误，catch 仅 `emit error` 不删除消息，runner 将状态置为 `paused`。用户再次点「恢复运行」时，`chatAgentStream` 会再写一条同样的 system user 消息。

本轮修复恰好命中该根因：不是去删错误后残留的消息，也不是在 resume 层加「是否已注入」的状态查询，而是在 `chatAgentStream` 的写入口增加幂等去重，使重复 resume 在数据层面天然不可注入第二条。

### 2.5 `docs/development/concurrency.md` §8

§8.4 明确会话手动恢复的不变量：

- 唯一互斥点 = 条件写 `paused → running`；
- `source:"system"` user 消息由 `chatAgentStream` 起流后写入；
- 注入与起流同源，不存在「消息已写、流未起」的孤儿窗口。

本轮修复没有破坏上述不变量，反而强化了「注入与起流同源」的幂等性：即使起流被触发多次，同内容的 system 消息也只会写入一次。

---

## 3. S1 根因与修复判定

### 3.1 根因

`SessionService.resume` 使用 `source: "system"` 向 `chatAgentStream` 发送续跑提示，但 `chatAgentStream` 的去重守卫原本只识别 `super` 与 `manager`。因此：

- 第一次 resume：写入 `role=user, source=system` 的续跑提示，跑 LLM；
- 若该轮因 LLM 故障/预算耗尽等错误而终了，runner 把会话状态归位为 `paused`；
- 第二次 resume：`chatAgentStream` 再次走过 `!prepared.skipUserCreate` 分支，写入**第二条**同内容 system 提示。

### 3.2 修复是否属于架构层根治

判定标准（引用 `AGENTS.md`「禁止打补丁」铁律）：

> 删掉编排层补丁，bug 还会不会复现？会复现 → 打的还是补丁；不会复现 → 不变量已收进 reducer/原子操作。

本轮修复：**不是补丁**。

- 未新增 `await hydrate`、`setTimeout`、`queueMicrotask`、`phase === "xxx"` 等时序猜测；
- 未在 resume 的 `onDone`/`onError`/`finally` 中补二次检查；
- 修改的是 `chatAgentStream` 的**数据写入不变量**：「对 super/manager/system 源，同 session 同内容的 user 消息只写一次」。该不变量由一次带条件的 DB 查询 + `skipUserCreate` 标志强制，不依赖调用方时序。

若把 `SessionService.resume` 的编排层代码全部删掉、直接多次调用 `chatAgentStream(..., source="system", ...)`，重复注入也不会发生——因为 `chatAgentStream` 自身会拒绝重复写入。这符合「不变量收进 store/数据层」的标准。

唯一可挑剔之处：去重键是 `sessionId + role + content`，没有额外限定 `source = "system"`。这意味着如果某条普通用户消息恰好与固定续跑提示文本完全一致，也会被误去重。但该提示文本是项目内置的固定句子 `"（服务已重启，请继续完成未完成的任务）"`，与用户正常输入冲突的概率极低；且 super/manager 的去重同样采用 `content` 键，扩展 system 后语义一致。若未来需要更严格的去重，可改为 `{ sessionId, role, source, content }` 联合键，但这属于优化而非阻塞项。

### 3.3 与 AGENTS.md 铁律的符合度

- ✅ 未打时序补丁；
- ✅ 未新增向后兼容包袱（未保留旧路径，直接扩展源判断）；
- ✅ 未在调用方增加脆弱编排；
- ⚠️ 去重守卫仍位于 `chatAgentStream` 这一「编排入口」而非更底层的数据库唯一约束；但鉴于 SQLite 无法对 `source` 做条件唯一索引，且 Prisma 层不便表达「仅当 source 为 system/super/manager 时唯一」，用查询守卫是合理的工程折中，符合「把不变量尽量下沉」的精神。

---

## 4. 回归风险评估

### 4.1 对 super/manager 去重行为的影响

**无回归**。改动把原先整体执行的「查 dup → 查 assistant → 可能早退」逻辑整体包进了 `if (src !== "system")` 分支。对 `super`/`manager`：

- 重复 user 消息仍会被发现；
- 若其后存在 assistant 消息，仍直接 emit `done` 并 `return`；
- 若不存在 assistant 消息，仍 `skipUserCreate=true` 后继续跑 LLM。

代码路径与原先完全一致。

### 4.2 对 system 源其他路径的影响

目前全仓只有 `SessionService.resume` 使用 `source: "system"`。grep 验证：

```bash
grep -R "source:\s*\"system\"" apps/server/src --include="*.ts"
# 命中：services.ts:1509 resume body 一处
```

因此扩展去重只影响 resume 流程，不会影响普通用户消息（`source` 缺省为 `"user"`）。

### 4.3 并发竞态

`chatAgentStream` 内的去重查询本身不是原子操作，理论上存在「两个 runner 同时查到无 dup，然后都写入」的 race。但：

1. `SessionService.resume` 的条件写已经把并发 double-resume 串行化；
2. `hub.startIfNotRunning` 在 hub 层再次保证同一 session 同时只有一个活跃 runner。

因此实际生产路径不会出现两个 `chatAgentStream` 并发写同一条 system 消息。T7 的 `chatSpy` 断言（仅调 1 次）和 T9 的顺序断言共同覆盖了主要风险。

### 4.4 测试覆盖度

- T6：验证正常 resume 的系统消息上链、assistant 不重复、终态归位 active；
- T7：验证并发 double-resume 互斥，系统消息仅 1 条；
- T8：验证非 paused 状态拒绝、已 running 幂等；
- T9：验证顺序重复 resume 不重复注入 system 消息。

T7 + T9 的组合对 S1 足够。若要求更严格，可补充一条「resume 后 LLM 报错 → 状态回 paused → 再次 resume」的真实失败路径，但 T9 通过手动改回 `paused` 已经等效验证了去重守卫，不必阻塞。

### 4.5 实跑验证

本轮审查执行了：

| 命令 | 结果 |
|---|---|
| `cd apps/server && npx vitest run src/__tests__/sessionResume.test.ts` | ✅ 4 passed（T6/T7/T8/T9） |
| `pnpm test` | ✅ 49 test files / 488 tests passed |
| `cd apps/web && pnpm run test:e2e:mock:prep && pnpm run test:e2e:mock` | ✅ 20/20 passed |
| `pnpm --filter @knowpilot/web build` | ✅ 生产构建成功 |
| `pnpm lint` | ✅ shared/server `tsc --noEmit` + web `eslint` 全过 |

> 注：首次运行 vitest 时，`test.db` 因历史 FTS 虚表残留导致 `prisma db push` 报 `no such table: search_fts_config`。按 `globalSetup.ts` 设计删除 `apps/server/prisma/test.db*` 后重新运行即通过。此问题与 S1 修复无关，属于本地测试产物状态。

---

## 5. 结论

### 5.1 判定

**通过。**

S1 的根因已被准确命中，修复属于架构层幂等去重而非时序补丁；`super`/`manager` 源行为未受回归影响；T9 负向回归测试能够有效检测旧实现的重复注入问题；T6/T7/T8/T9 全部通过，全量 server 测试、mock E2E、web 生产构建与 lint 均通过。

### 5.2 阻塞项

无。

### 5.3 非阻塞建议

1. 若未来续跑提示文案可变（i18n/动态生成），建议把去重键从纯 `content` 升级为 `{ sessionId, role, source, content }`，避免与普通用户消息巧合冲突。
2. 可考虑在 `SessionService.resume` 注释中补充：「系统提示的幂等性由 `chatAgentStream` 的 `system` 源去重守卫保证」，便于后续维护者理解双层防护。

---

> 审查人签名：阶段三自审 Agent  
> 日期：2026-07-17
