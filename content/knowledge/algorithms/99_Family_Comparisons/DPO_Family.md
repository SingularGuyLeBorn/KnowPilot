# DPO Family: 偏好优化算法大比拼

本章节汇总了 DPO 及其主要变体(IPO, SimPO, ORPO, KTO)的核心差异、适用场景及优缺点. 

---

## 1. 算法概览

| 算法 | 全称 | 核心思想 | 关键公式差异/Loss形式 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **DPO** | Direct Preference Optimization | 将 RLHF 建模为二分类问题 | $-\log \sigma (\beta \log \frac{\pi}{\pi_{ref}})$ | 标准 SFT 模型对齐，通用场景 |
| **IPO** | Identity Preference Optimization | 均方误差回归，避免过拟合 | $(h - \frac{1}{2\beta})^2$ | 数据噪声大、需要强正则化的场景 |
| **SimPO** | Simple Preference Optimization | 无 Reference 模型，引入 Margin | $-\log \sigma (\frac{\pi}{\pi} - \gamma)$ | 显存受限、推理速度敏感(长度惩罚) |
| **ORPO** | Odds Ratio Preference Optimization | 在 SFT 过程中加入 Odds Ratio 惩罚 | $L_{sft} + \lambda L_{or}$ | 从头训练(Pretrain -> Aligned)，无 Ref |
| **KTO** | Kahneman-Tversky Optimization | 基于前景理论的非成对优化 | Loss Aversion 加权 | **非成对数据** (只有 Good 或只有 Bad) |

---

## 2. 核心维度对比

### 2.1 是否需要 Reference Model？

- **需要**: DPO, IPO, KTO (通常需要计算 KL 或隐式奖励，必须加载 Ref 模型)
- **不需要**: SimPO, ORPO (这也是它们最大的工程优势，省了一半显存，训练速度快)

### 2.2 损失函数形式

#### (1) Sigmoid 类 (分类思想)
DPO, SimPO, ORPO 都使用了 Logistic Loss ($-\log \sigma(\dots)$). 
这意味着它们本质上是在做一个**二分类任务**: 让 $P(Good) > P(Bad)$. 
- **优点**: 梯度对于"错误样本"(Hard Negative)很大，学习效率高. 
- **缺点**: 由于 Sigmoid 的饱和区特性，对于"已经分类正确"的样本梯度几乎为 0. 这可能导致模型停止对 Easy Sample 的优化，也可能在噪声数据上过拟合. 

#### (2) Regression 类 (回归思想)
IPO 使用了 MSE Loss. 
- **优点**: 梯度是线性的，不会消失. 即使样本已经分类正确，只要还没达到 Target Margin，依然会有梯度. 这提供了更强的正则化. 
- **缺点**: 收敛可能稍慢. 

#### (3) Prospect Theory (非对称)
KTO 引入了心理学权重. 
- **特点**: 对 Good 和 Bad 样本赋予不同的权重($\lambda_D$)，模拟人类的损失厌恶. 这对于数据不平衡场景极其有效. 

---

## 3. 详细算法剖析

### 3.1 DPO vs IPO
- **现象**: DPO 训练久了，KL 散度会激增，生成的概率分布会退化(趋向于 Deterministic). 
- **原因**: DPO 试图推高 Good 压低 Bad 到极致. 
- **IPO解法**: 设定一个 Target Gap(比如 Log Odds 差值为 10)，只要达到这个 Gap 就停止推动. 这相当于加了一个"刹车". 

### 3.2 DPO vs SimPO
- **现象**: DPO 训练出的模型倾向于生成**更长**的回答(Length Bias). 
- **原因**: Implicit Reward 中没有长度归一化，长回答的总 LogProb 通常更高(虽然 DPO 是差值，但 Reference Model 对长回答的 LogProp 可能衰减得不够快？). 
- **SimPO解法**: 
  1. 使用 **Average LogProb** (除以长度). 
  2. 引入 **Target Margin** ($\gamma$). 
  3. 彻底移除 $\pi_{ref}$，直接优化 $\pi$ 自身的生成概率. 

### 3.3 DPO vs ORPO
- **场景**: 你刚做完 Pre-training，手里还没 SFT 模型. 
- **DPO流程**: SFT -> Save Model -> Load as Ref & Policy -> DPO. 两阶段. 
- **ORPO流程**: Load Base Model -> SFT + OR Preference Loss. 一阶段. 
- **优势**: ORPO 在 SFT 的同时就把偏好学了，效率极高. 

### 3.4 DPO vs KTO
- **数据**: 你只有一堆用户点赞(Thumbs Up)的数据，没有点踩的，也没有成对比较. 
- **DPO**: 没法跑(必须构成 Pairs). 
- **KTO**: 可以直接跑. 把它作为 Good 样本并赋予 Desirable Weight 即可. 

---

## 4. 选型指南 (Decision Framework)

1. **显存够吗？**
   - **不够 (只有1张卡)** : 选 **SimPO** 或 **ORPO** (省去 Ref Model). 
   - **够 (2张卡以上)** : 继续看. 

2. **数据类型？**
   - **成对数据 (A > B)** : 继续看. 
   - **非成对数据 (A is Good)** : 选 **KTO**. 

3. **已有 SFT 模型吗？**
   - **有**: 选 **DPO**, **IPO**, **SimPO**.
   - **没有 (只有 Base)** : 选 **ORPO** (可以一步到位，虽然通常建议还是先 SFT 一下). 

4. **追求指标还是稳定性？**
   - **刷榜 (AlpacaEval)** : **SimPO** (长度归一化通常能刷出高分). 
   - **生产环境 (稳定性)** : **IPO** (不易过拟合). 

---

## 5. 总结

RLHF 的偏好优化领域正在经历"**去复杂化**"(Simplification) 的过程: 
- PPO -> DPO (去掉了 Critic, PPO Loop)
- DPO -> SimPO (去掉了 Reference Model)
- DPO -> KTO (去掉了 Pairing 约束)
- DPO -> IPO (去掉了 Sigmoid trick)

趋势是: **更少的移动部件，更直接的优化目标. **
