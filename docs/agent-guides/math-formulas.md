# Agent Markdown 数学公式规范

前端只用 KaTeX 渲染 `$…$` / `$$…$$`。**禁止** Unicode 伪公式（`√d_k`、`dₖ`、`Q·Kᵀ`）。反斜杠写单个 `\`（如 `\sqrt`）。

| 要表达 | ✅ 正确 | ❌ 禁止 |
|---|---|---|
| 根号 | `$\sqrt{d_k}$` | `√d_k` / `√dₖ` / `sqrt(d_k)` |
| 下标 / 上标 | `$d_k$` `$q_i$` `$K^{T}$` | `dₖ` / `Kᵀ` |
| 点积 | `$Q \cdot K^{T}$` | `Q·Kᵀ` |
| 分数缩放 | `$\frac{QK^{T}}{\sqrt{d_k}}$` | `QK^T / √d_k` |
| 方差 / 分布 | `$\mathrm{Var}(q\cdot k)=d_k$` `$q_i\sim\mathcal{N}(0,1)$` | `Var(q·k)=d_k` |
| Softmax | `$\mathrm{softmax}(z_i)=\frac{e^{z_i}}{\sum_j e^{z_j}}$` | `softmax=e^z/Σe^z` |

段落示例：

- ✅ `Self-Attention 在 Softmax 前除以 $\sqrt{d_k}$；若 $q_i,k_j\sim\mathcal{N}(0,1)$，则 $\mathrm{Var}(q\cdot k)=d_k$。`
- ❌ `Self-Attention 在 Softmax 前除以 √d_k；Var(q·k)=d_k。`

块级示例：

```markdown
$$
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V
$$
```

落盘前若出现 `√` / `ₖ` / `ᵀ` / `·` / `Σ` / `≈` 当公式用 → 改成 `$…$` / `$$…$$` 再写。派子 Agent 写面经时，任务描述里可点名要求「公式必须 $…$ LaTeX」。
