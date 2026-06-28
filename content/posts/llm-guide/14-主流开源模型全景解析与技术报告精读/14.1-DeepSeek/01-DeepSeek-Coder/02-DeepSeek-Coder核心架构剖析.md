---
title: "DeepSeek-Coder 核心架构剖析"
---
# DeepSeek-Coder 核心架构剖析

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**

> 本文基于《DeepSeek-Coder 技术报告精译》与 D5 核心技术专题, 对 DeepSeek-Coder 的架构进行系统性梳理. Coder 是 DeepSeek 家族的第一款开源模型, 专注于代码智能领域.
> 详细分析请参阅 [05-DeepSeek-Coder-Architecture-Overview.md](./05-DeepSeek-Coder-Architecture-Overview.md).

---

## 1 设计动机: 代码模型的三个核心需求

DeepSeek-Coder 发布于 2023 年 11 月, 其核心任务是解决代码模型的三个需求:

1. **仓库级代码理解**: 需要理解跨文件的依赖关系和项目结构.
2. **Fill-in-the-Middle(FIM)**: 代码补全需要预测中间段, 而非仅仅续写.
3. **多语言支持**: 支持多种编程语言, 需要广泛的语言知识.

---

## 2 整体架构

| 超参数     | Coder 配置                        |
| :--------- | :-------------------------------- |
| 架构       | Dense Transformer                 |
| 模型尺寸   | 1B, 5.7B, 6.7B, 33B               |
| 层数       | 32-62                             |
| 隐藏维度   | 2048-7168                         |
| 注意力头数 | 16-56                             |
| 上下文窗口 | 16K                               |
| 预训练数据 | 2T token(87% 代码 + 13% 自然语言) |

> 表 1: DeepSeek-Coder 核心配置.

Coder 采用标准 Dense Transformer 架构, 没有使用 MoE. 这是因为早期 DeepSeek 团队选择了「先验证代码领域价值, 再探索稀疏架构」的研发策略.

---

## 3 关键创新

### 3.1 仓库级语料构建

Coder 的预训练数据不仅包含单个代码文件, 还包含完整的代码仓库. 这使得模型可以学习到:

- 跨文件的函数调用关系
- 项目目录结构和模块组织
- 代码与配置文件(如 package.json、requirements.txt)的关联

### 3.2 Fill-in-the-Middle(FIM)

FIM 训练将代码文件随机分割为前缀-中间-后缀三部分, 模型需要预测中间段:

```
<PRE> prefix <SUF> suffix <MID> middle
```

这种训练方式显著提升了代码补全和编辑能力, 成为后续代码模型的标准训练流程.

> 译者注: FIM 的设计灵感来自代码编辑的实际场景. 开发者在 IDE 中经常需要在已有代码中间插入新逻辑, 而不是在文件末尾续写. FIM 训练使模型学会了「双向上下文理解」——同时考虑前缀和后缀来生成中间内容. 这一方法后来被广泛应用于所有主流代码模型(GitHub Copilot、CodeLlama、StarCoder 等).

### 3.3 三阶段学习率调度

Coder 采用三阶段学习率调度:

1. **Warmup**: 线性升温.
2. **稳定期**: 保持峰值学习率.
3. **衰减期**: 余弦衰减.

这种调度在代码预训练中尤为重要, 因为代码数据的分布与通用文本不同, 需要更谨慎的学习率控制来避免灾难性遗忘.

---

## 4 性能与影响

DeepSeek-Coder 在 HumanEval、MBPP 等代码生成基准上取得了当时的开源最佳成绩. 更重要的是, Coder 为 DeepSeek 后续的技术路线埋下了两颗种子:

1. **FIM 启发了 V3 的 MTP**: Multi-Token Prediction 可以看作是 FIM 的通用化版本.
2. **代码数据工程经验**: 为 Coder-V2 的 4T 代码语料构建提供了方法论基础.

---

> 本文档为综合架构剖析. 详细精译见《01-DeepSeek-Coder技术报告精译.md》, 架构深入分析见《05-DeepSeek-Coder-Architecture-Overview.md》.
