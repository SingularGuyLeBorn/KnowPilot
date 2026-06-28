---
title: "04 · DeepSeek-Coder-V2 - 中文交付稿"
source: 03-DeepSeek-Coder-V2-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-24
---

# DeepSeek-Coder-V2: 打破闭源模型在代码智能中的壁垒

> [返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)

## 摘要

DeepSeek-Coder-V2 是一个开源的 Mixture-of-Experts, MoE, 代码大模型. 它基于 DeepSeek-V2 的中间 checkpoint, 在额外 6T token 上继续预训练, 从而同时增强代码能力、数学推理能力与长上下文处理能力. 相比早期的 DeepSeek-Coder-33B, Coder-V2 将支持语言从 86 种扩展到 338 种, 将上下文窗口从 16K 提升到 128K, 并在多项标准基准上达到或逼近 GPT-4 Turbo、Claude 3 Opus、Gemini 1.5 Pro 的水平.

![](images/fig01_performance_comparison.jpg)

Figure 1 | DeepSeek-Coder-V2 在代码与数学基准上的总体表现.

> 译者注: 这篇报告最重要的信号不是“开源模型又快了一点”, 而是开源代码模型第一次系统性地逼近当时最强的闭源编程助手. 这意味着 DeepSeek 不再把代码模型当作通用模型的附属分支, 而是把它当作一个独立产品线来做完整的数据、训练和对齐闭环.

## 1. 引言

开源社区已经通过 StarCoder、CodeLlama、DeepSeek-Coder、Codestral 等模型持续推动代码智能的发展, 但与 GPT4-Turbo、Claude 3 Opus、Gemini 1.5 Pro 等闭源模型相比, 在综合代码能力、长上下文与真实工程任务上仍有明显差距. DeepSeek-Coder-V2 的目标, 就是在保持开源可用性的前提下, 尽可能缩小这个差距.

报告给出的核心方案是: 不再从零训练一个纯 Dense 的代码模型, 而是复用 DeepSeek-V2 这个通用 MoE 基座, 再用大规模代码、数学和自然语言混合语料做持续预训练.

> 译者注: 这里的关键决策是“基于 V2 继续训练”, 而不是在 DeepSeek-Coder-33B 之上继续堆 token. 原因很直接: V2 既有更强的通用推理能力, 又有 MoE 架构带来的更高推理效率. 代码模型在真实场景中并不只做补全, 还要理解需求、解释错误、写文档、做多轮修复, 所以通用能力并不是可有可无的附属品.

## 2. 预训练数据构成

DeepSeek-Coder-V2 的预训练数据由三部分组成:

- 60% 源代码
- 10% 数学语料
- 30% 自然语言语料

其中, 代码部分主要来自 GitHub 与 CommonCrawl, 复用了 DeepSeekMath 的召回与过滤流程. 新版代码语料覆盖 338 种编程语言, 相比初代 DeepSeek-Coder 的 86 种有大幅扩展. 数学语料达到 221B token, 约为 DeepSeekMath 120B 语料的两倍. 自然语言部分则直接采样自 DeepSeek-V2 的训练语料.

报告还给出了一个重要消融: 使用 1B 模型训练新代码语料后, HumanEval 从 30.5% 提升到 37.2%, MBPP 从 44.6% 提升到 54.0%. 这说明数据质量提升不仅是“规模更大”, 更是“领域覆盖更全、清洗更有效”.

> 译者注: 60/10/30 的比例很能说明 DeepSeek 的产品判断. 如果把代码占比继续拉高, 模型的确可能在某些纯代码基准上再涨一点, 但会更容易丢掉通用语言理解能力. Coder-V2 反而保留了 30% 的自然语言语料, 本质是在为“代码助手”而不是“代码生成器”服务.

## 3. 数据收集与过滤流程

代码数据来自 2023 年 11 月之前创建的 GitHub 公开仓库. 在原始抓取后, 团队沿用了 DeepSeek-Coder 阶段已经验证过的过滤规则, 例如:

- 平均行长度超过 100 字符, 或最大行长度超过 1000 字符的文件会被过滤
- 字母字符占比不足 25% 的文件会被过滤
- XML 头、异常 HTML、过长或过短的 JSON/YAML 文件会被过滤

处理完成后, 团队得到:

- 821B 代码 token, 覆盖 338 种语言
- 185B 代码相关文本, 包括 markdown、issue 等
- 70B 代码相关网页 token
- 94B GitHub 额外高质量源代码

最终合并为 1,170B 代码相关 token.

CommonCrawl 召回部分使用了与 DeepSeekMath 相同的 fastText 迭代召回流程, 但特别强调分词使用的是 DeepSeek-V2 的 BPE tokenizer, 而不是简单空格分词. 这显著改善了中文等无空格语言的召回效果.

> 译者注: 这一点很容易被忽略, 但对中文编程场景非常关键. 如果代码仓库里有中文注释、中文 issue、中文文档, 用空格分词做 fastText 召回会严重失真. 直接复用 V2 的 BPE tokenizer, 等于让“数据召回的 token 空间”和“模型训练的 token 空间”保持一致, 这是非常成熟的数据工程做法.

## 4. 训练策略

### 4.1 持续预训练

DeepSeek-Coder-V2 不是从头训练, 而是在已经训练过 4.2T token 的 DeepSeek-V2 中间 checkpoint 上继续训练 6T token. 因此, 整个模型总暴露 token 数达到 10.2T.

这种设计有三个直接收益:

- 节省从零训练超大模型的计算成本
- 保留 DeepSeek-V2 的通用语言能力
- 让代码和数学增强建立在已有的强基座上

### 4.2 训练目标

16B Lite 版本同时使用 Next-Token Prediction 与 Fill-In-Middle, FIM. 236B 版本只使用 Next-Token Prediction. FIM 使用 PSM, Prefix-Suffix-Middle, 格式, 并以 0.5 的比例混入预训练数据.

这背后的定位区分很清楚:

- 16B Lite 更偏向 IDE 补全、端侧或轻量服务
- 236B 更偏向完整的对话式编程助手

### 4.3 模型架构

模型架构直接沿用 DeepSeek-V2:

- 16B Lite 对应 V2-Lite
- 236B 对应 V2
- 236B 总参数, 21B 激活参数
- 16B 总参数, 2.4B 激活参数

报告中特别提到, 在代码数据上训练时曾遇到梯度尖峰和不稳定问题, 团队最终回退到更传统的归一化方式.

> 译者注: 这说明“复用通用模型架构”并不等于“通用训练配方可以原样照搬”. 代码语料的统计分布与自然语言不同, 稀有符号、格式约束、超长结构都更多. 一个在通用语料上稳定的技巧, 在代码域可能反而放大不稳定性.

### 4.4 长上下文扩展

Coder-V2 使用 Yarn 把上下文窗口从 16K 扩展到 128K. 扩展过程分两阶段:

- 第一阶段: 32K 序列长度, batch size 1152, 训练 1000 步
- 第二阶段: 128K 序列长度, batch size 288, 再训练 1000 步

报告指出, 训练时还提高了长上下文数据的采样比例, 以保证模型在扩展阶段真的“看到足够多的长序列”.

![](images/fig02_niah_test.jpg)

Figure 2 | NIAH, Needle In A Haystack, 长上下文测试结果.

> 译者注: 这个两阶段策略不是形式主义. 如果直接从 16K 跳到 128K, attention 分布会发生太剧烈的变化, 模型很容易训练崩掉. 先让模型在 32K 上适应中程依赖, 再过渡到 128K, 是一个很典型的工程保守策略.

## 5. 对齐阶段

### 5.1 监督微调, SFT

对齐阶段首先构建了一个混合指令数据集:

- 20k 代码相关指令数据, 来自 DeepSeek-Coder
- 30k 数学相关数据, 来自 DeepSeek-Math
- 若干通用指令数据, 来自 DeepSeek-V2

最终 SFT 数据量约为 300M token. 训练使用 cosine 学习率调度, 100 步 warm-up, 初始学习率为 5e-6, batch size 1M token, 总训练量约 1B token.

### 5.2 强化学习, RL

SFT 之后, 团队进一步使用 GRPO 做强化学习对齐. 代码领域的偏好数据不是主要靠人工打分, 而是借助编译器反馈与测试用例自动收集. 但作者指出, 原始的 0/1 编译器信号过于粗糙, 因为测试覆盖可能不完整. 因此他们又训练了一个 reward model, 让其在 RL 阶段提供更平滑、更鲁棒的奖励信号.

![](images/fig03a_reward_model_signal.jpg)
![](images/fig03b_methods_performance.jpg)

Figure 3 | 奖励模型信号与不同 RL 策略的效果对比.

> 译者注: 这是这篇报告里最值得工程团队关注的一点. 代码 RL 的奖励天然可执行, 但“可执行”不等于“足够好用”. 编译器只会告诉你 pass 或 fail, 却不告诉你代码离正确答案还差多少. 奖励模型的作用, 正是在 pass/fail 之间补出一个更连续的优化梯度.

## 6. 核心评测结果

### 6.1 代码生成与代码理解

在 HumanEval、MBPP、LiveCodeBench、SWE-Bench 等指标上, DeepSeek-Coder-V2 全面超越早期开源代码模型. 报告强调:

- HumanEval 达到 90.2%
- MBPP 达到 76.2%
- LiveCodeBench 达到 43.4%
- 成为第一个在 SWE-Bench 上突破 10% 的开源代码模型

这说明 Coder-V2 不只是“写单函数更强”, 而是开始接近真实工程任务中的多步骤修复与推理.

### 6.2 数学推理

在 GSM8K、MATH、AIME 2024、Math Odyssey 上, Coder-V2 也表现出非常强的数学推理能力. 尤其是:

- MATH 达到 75.7%
- Math Odyssey 达到 53.7%
- AIME 2024 可达 4/30, 使用 maj@64 可进一步提升

这证明这不是一个只能补代码的窄模型, 而是一个在符号推理上被显著增强过的代码专用大模型.

> 译者注: 代码与数学在模型里并不是两条互不相关的能力线. 算法设计、程序执行、符号变换、边界条件推理, 本来就是共享同一类结构化思维的. DeepSeek 把 10% 数学语料混进代码训练, 本质是在为更强的“可执行推理”能力铺路.

### 6.3 通用自然语言能力

由于模型建立在 DeepSeek-V2 之上, Coder-V2 并没有因为代码训练而完全丢掉通用能力. 在 MMLU、BBH、Arena-Hard 等推理向基准上仍然维持了较强表现, 甚至在部分推理评测上超过了原始的 V2.

但报告也坦率承认:

- 在 TriviaQA、NaturalQuestions 这类知识密集型任务上, Lite 版本有明显下滑
- 在 MT-Bench、AlignBench 这类偏通用对话对齐的指标上, Coder-V2 不如原始的 V2 Chat

这反映出对齐资源向代码和数学倾斜之后, 通用知识问答和通用对话体验会付出代价.

## 7. 结论

DeepSeek-Coder-V2 的核心贡献可以概括为四点:

- 证明了通用 MoE 基座 + 持续领域预训练, 是一条可行而高效的代码模型路线
- 通过更高质量的代码语料和更大的语言覆盖, 把开源代码模型推到了新的上限
- 通过 Yarn 和两阶段长上下文训练, 把代码场景里的上下文能力扩展到 128K
- 通过 SFT + GRPO + reward model 的闭环对齐, 把模型从“会生成代码”推进到“更接近真实开发助手”

但它的局限也很明确: 指令遵循、复杂多文件工程任务、以及真正意义上的 agent 化修复, 仍然没有完全解决. 报告把这一点直说出来, 也等于为后续 DeepSeek-R1 的路线留出了技术空间.

## 全文完

## 关联文件说明

- 精译主稿: `01-DeepSeek-Coder-V2技术报告精译.md`
- 架构剖析: `02-DeepSeek-Coder-V2核心架构剖析.md`
- 英文矿稿: `03-DeepSeek-Coder-V2-mineru-en.md`
- 架构专题: `05-DeepSeek-Coder-V2-Architecture-Overview.md`
- Index 入口页: `05-DeepSeek-Coder-V2-Index.md`
