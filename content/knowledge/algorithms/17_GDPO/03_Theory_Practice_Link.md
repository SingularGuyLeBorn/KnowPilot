# Theory to Practice: GDPO / SteerLM

## 1. 核心映射 (Core Mapping)

GDPO (在本库中也作为 SteerLM 的实现载体) 的核心思想是 **Attribute Conditioning**. 它将 RL 问题转化为 Conditional Supervised Learning 问题. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **属性向量 (Attribute Vector)** | `{"helpfulness": 0.9, "humor": 0.2}` | Line 15-20 |
| **条件生成 (Conditioning)** | Prompt Augmentation (Prepend attributes) | Line 35-40 |
| **多维奖励 (Multi-Dim Reward)** | 模拟的 Multi-Head Reward Score | Line 55 |

---

## 2. 关键代码解析

### 2.1 Prompt 增强工程

SteerLM 不改变模型架构，只是改变 Input Format. 

```python
# 02_Implementation.py
def format_input(prompt, attributes):
    # e.g. "[Helpfulness:9, Humor:2] Explain Quantum Physics"
    attr_str = ",".join([f"{k}:{v}" for k,v in attributes.items()])
    return f"[{attr_str}] {prompt}"
```

**理论解释**:
这利用了 LLM 强大的 In-Context Learning 能力. 将 Reward (结果) 提前作为 Condition (原因) 输入给模型. 训练时使用真实的 Reward，推理时使用期望的 Reward (Steering). 

### 2.2 离线 vs 在线

SteerLM 本质上是 Offline 的 (SFT). 
但在 GDPO (Group Decoupled) 中，我们可以在 Online 阶段动态调整 Attribute 的采样分布. 

```python
# 动态调整目标
target_attributes = sample_attributes(distribution="high_quality")
conditioned_prompt = format_input(prompt, target_attributes)
```

---

## 3. 工程实现的细节

*   **Attribute Quantization**: 连续的 Reward 分数 (0.852) 通常被量化为离散等级 (0-9)，以便 Tokenizer 处理. 
*   **Data Augmentation**: 训练数据中需要包含各种质量的数据(不仅是好的，也要有坏的)，这样模型才能学会区分 "Helpfulness: 0" 和 "Helpfulness: 9". 

---

## 4. 总结

GDPO/SteerLM 证明了: 有时候你不需要极其复杂的 PPO 算法，只需要**更好地组织数据**(把 Reward 变成 Input)，Standard Transformer 就能自动学会 Alignment. 
