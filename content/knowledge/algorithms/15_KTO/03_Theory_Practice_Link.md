# Theory to Practice: KTO (Kahneman-Tversky Optimization)

## 1. 核心映射 (Core Mapping)

KTO 将前景理论 (Prospect Theory) 的核心发现——**损失厌恶 (Loss Aversion)** ——直接映射到了 Loss 函数中. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **参考点 (Reference Point)** | `KL(policy || ref)` 隐含在 Log Ratio 中 | Line 40-42 |
| **非成对数据 (Unpaired)** | 单独处理 Chosen `(x, y_w)` 和 Rejected `(x, y_l)` | Line 58, 62 |
| **损失厌恶系数 (Lambda)** | `lambda_d` vs `lambda_u` | Line 16-17 |
| **价值函数 (Value Function)** | 复杂的 Log Sigmoid 组合 | Line 48-51 |

---

## 2. 关键代码解析

### 2.1 隐式奖励 (Implicit Reward)

KTO 不训练 Reward Model，也不需要成对数据. 它假设最优 Policy $\pi^*$ 满足: 
$$ r(x,y) = \beta \log \frac{\pi^*(y|x)}{\pi_{ref}(y|x)} + \log Z(x) $$
代码中直接计算 Log Ratio 作为 Implicit Reward: 

```python
# 02_Implementation.py
chosen_logratios = chosen_logprobs - chosen_ref_logprobs
rejected_logratios = rejected_logprobs - rejected_ref_logprobs
```

### 2.2 KTO Loss Function

这是 KTO 的灵魂. 它分别根据样本是 "Desirable" (Good) 还是 "Undesirable" (Bad) 来施加不同的梯度力度. 

```python
# 02_Implementation.py
# Desirable (Chosen) Term
losses.append(1 - F.sigmoid(self.beta * (chosen_logratios - z_chosen)))

# Undesirable (Rejected) Term
# Note the lambda_d coefficient (Loss Aversion)
losses.append(1 - F.sigmoid(self.beta * (z_rejected - rejected_logratios)))
```

**理论解释**:
人类对"失去"(Rejected被误选)的痛苦大于"获得"(Chosen被选中)的快乐. 
因此，KTO 通常设置 $\lambda_{rejected} > \lambda_{chosen}$ (e.g., 1.33 vs 1.0). 这使得模型在训练时更加“保守”，极力避免生成坏样本. 

---

## 3. 工程实现的优势

*   **数据效率**: 只要有 Good/Bad 标签即可，不需要严格的 A > B 配对. 允许使用大量的 A (Good) 和 C (Bad) 数据来训练. 
*   **计算效率**: 无需 RM，跳过了 Reward Modeling 阶段. 

---

## 4. 超参数选择

*   `Beta`: 类似于 KL 惩罚，控制对 Ref 的偏离. 范围 0.1 ~ 0.5. 
*   `Desirable Weight`: 通常设为 1.0. 
*   `Undesirable Weight`: 通常设为 1.33 (Prospect Theory 建议值). 
