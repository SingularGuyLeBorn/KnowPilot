# 每日碎片周报 {{week_start}} ~ {{week_end}}

> 自动生成于 {{generation_date}} | 碎片总数：{{total_count}}

---

## 📊 本周概览

| 类别 | 数量 | 占比 |
|------|------|------|
| 💡 灵感 | {{insight_count}} | {{insight_pct}}% |
| ✅ 待办 | {{todo_count}} | {{todo_pct}}% |
| 😌 情绪 | {{emotion_count}} | {{emotion_pct}}% |
| 📚 知识点 | {{knowledge_count}} | {{knowledge_pct}}% |
| 🎪 琐事 | {{trivia_count}} | {{trivia_pct}}% |
| ❓ 待澄清 | {{clarify_count}} | {{clarify_pct}}% |

**待办完成率**：{{todo_completion_rate}}%  
**晋升为笔记**：{{promoted_notes}} 篇

---

## 💡 高光灵感（Top 3）

{{#each top_insights}}
- **{{date}}** · {{tags}} — {{refined}}
  > 关联：{{links}}
{{/each}}

---

## ✅ 待办进展

### ✅ 已完成
{{#each done_todos}}
- [x] {{refined}} （{{date}}）
{{/each}}

### 🔄 进行中
{{#each doing_todos}}
- [ ] {{refined}} （{{date}}，优先级：{{priority}}）
{{/each}}

### 📥 新增待办
{{#each new_todos}}
- [ ] {{refined}} （{{date}}，优先级：{{priority}}）
{{/each}}

---

## �  情绪趋势

{{#each emotion_summary}}
- **{{emotion}}**：{{count}} 次（{{dates}}）
{{/each}}

> 连续 {{max_streak_days}} 天出现「{{dominant_emotion}}」—— {{streak_note}}

---

## 📚 知识积累

### 新晋升笔记
{{#each promoted_notes}}
- **《{{title}}》** — 关联碎片 {{frag_count}} 条 | 标签：{{tags}}
{{/each}}

### 高频标签（本周 ≥3 条）
{{#each hot_tags}}
- **{{tag}}**：{{count}} 条 → {{action_suggestion}}
{{/each}}

---

## ❓ 待澄清清单（超 7 天未回复）

{{#each pending_clarifications}}
- **{{date}}** — {{raw}}
  > 回问：{{clarify_question}}
  > 已等待：{{days_waiting}} 天
{{/each}}

---

## 🔮 下周关注

1. {{focus_1}}
2. {{focus_2}}
3. {{focus_3}}

---

*—— 由「每日碎片」园丁长自动汇总*