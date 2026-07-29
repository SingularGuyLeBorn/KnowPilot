# Theory to Practice: OREO

## 1. 核心映射 (Core Mapping)

OREO 将 Offline RL 中的经典技巧 (BCQ, CQL) 引入到了 LLM Reasoning 中. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 |
| :--- | :--- | :--- |
| **Value Estimation** | `MSE(V(s), R)` | Line 38 |
| **Advantage Weighting** | `exp(V / alpha)` | Line 48 |
| **Policy Optimization** | `Weighted CrossEntropy` | Line 66 |

## 2. 为什么需要 Value Model?

在 **DPO** (第7章) 中，我们通过 $y_w$ 和 $y_l$ 的对比隐式地消除了 Value Function. 
这在偏好对齐 (Preference Alignment) 中是没问题的. 

但在 **推理 (Reasoning)** 任务中，一个长达 100 步的推理链，可能只有第 50 步错了一个符号. 
DPO 会因为这一个错误否定整个链条. 
OREO 通过训练 Value Model，能够学习到: "前 49 步其实是很好的，只有第 50 步 Value 掉下去了". 
这使得 Policy 可以保留前 49 步的正确知识，只修正第 50 步. 

## 3. 实现细节

代码中使用 `torch.exp(values / alpha)` 作为权重. 
这本质上是在执行 **AWR (Advantage Weighted Regression)** . 
只有当某一步的 Value 高时，我们才大力学习这一步的 Token 生成. 

## 4. 2026 前瞻
显式 Value Model 的回归 (The Return of the Value Function) 是 2025 年的一个重要趋势. DeepSeek R1 的成功也离不开 Process Verification (本质也是 Value). 
