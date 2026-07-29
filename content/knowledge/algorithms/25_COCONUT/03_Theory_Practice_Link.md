# Theory to Practice: COCONUT

## 1. 核心映射 (Core Mapping)

COCONUT 的核心在于 **Bypass Discrete Decoding**. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 |
| :--- | :--- | :--- |
| **Token Space Reasoning** | `decode(argmax(logits))` | N/A (Standard CoT) |
| **Latent Space Reasoning** | `model(current_thought)` | Line 33 |
| **Continuous Trace** | `thought_trace.append` | Line 37 |

## 2. 为什么这是未来?

目前的 DeepSeek R1 虽然强大，但在输出长达 10,000 Token 的 CoT 时，效率极低. 
而且很多中间步骤(如只有计算机能懂的数值计算)并不需要翻译成人类语言. 

`LatentThoughtModel` 展示了如何让模型"闭嘴思考". 
在代码中，`current_thought` 向量直接在循环中递归更新，没有任何 `argmax` 或 `softmax` 操作打断梯度的流动. 
这意味着由于整个过程是可微的，我们甚至可以直接对思考过程进行 **Backprop Through Time (BPTT)** ！

## 3. 局限性
人类无法直接读懂 Latent Vector. 这带来了可解释性 (Interpretability) 的巨大挑战. 
未来的方向可能是 **混合推理 (Hybrid Reasoning)** : 大部分时间潜意识思考 (COCONUT)，关键节点输出显式语言 (CoT). 
