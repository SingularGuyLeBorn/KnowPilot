# Theory to Practice: RLVR

## 1. 核心映射 (Core Mapping)

RLVR 将强化学习环境 (Environment) 具象化为 **编译器 (Compiler)** 或 **验证器 (Verifier)** . 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 |
| :--- | :--- | :--- |
| **可验证环境 (Environment)** | `class MathVerifier` | Line 3 |
| **稀疏奖励 (Sparse Reward)** | `return 1.0` if Correct else `-1.0` | Line 19 |
| **格式约束 (Format Constraint)** | Regex `\\boxed{(\d+)}` | Line 16 |

## 2. 代码解析

### 2.1 验证器的确定性
与基于人类反馈 (RLHF) 的 Reward Model 不同，`MathVerifier` 是 **0 方差** 的. 
```python
if student_answer == ground_truth:
    return 1.0
```
这种确定性允许模型进行极其激进的探索 (Exploration)，因为只要做对了，信号就是极其明确的. 

### 2.2 格式作为一种约束
代码中对 `\boxed{}` 的检查模拟了 DeepSeek R1 训练中的格式奖励. 
模型不仅要算对，还要学会**如何提交答案**. 这迫使模型在内部 CoT 中组织语言，最后按规范输出. 

## 3. DeepSeek R1 的秘密
DeepSeek R1 之所以能展现出惊人的推理能力，本质上就是在大规模的 RLVR 环境中，让模型“自己玩自己” (Self-Play)，通过验证器的反馈不断强化那些引发正确答案的思维路径 (CoT). 
随着训练进行，CoT 会变得越来越长，包含越来越多的自我纠错. 
