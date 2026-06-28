---
title: "05 · What is OpenAI-o1"
date: 2026-05-11
tags: []
---

# 05 What is OpenAI-o1

## 1. What is OpenAI-o1

**OpenAI o1**系列模型是经过强化学习训练的新型大型语言模型,可以进行复杂的推理. o1模型会[先思考后回答](https://openai.com/index/introducing-openai-o1-preview/),在响应用户之前会产生一个长长的内部思路链. o1模型在科学推理方面表现出色,在竞争性编程问题(Codeforces)中排名第89位,在美国数学奥林匹克竞赛(AIME)资格赛中跻身美国前500名学生之列,在物理、生物和化学问题(GPQA)基准测试中的准确度超过了人类博士水平.

API 中有两种可用的推理模型：

1. o1：旨在利用有关世界的广泛常识来推理难题.2. o1-mini：o1 的更快、更实惠的版本,特别擅长不需要大量常识的编码、数学和科学任务.

**>********>这是OpenAI Strawberry(o1) 和 Reasoning**>的研究论文和博客的集合>

[GitHub - hijkzzz/Awesome-LLM-Strawberry: A collection of LLM papers, blogs, and projects, with a focus on OpenAI o1  and reasoning techniques.](https://github.com/hijkzzz/Awesome-LLM-Strawberry)

[《OpenAI o1大模型》英文技术报告.pdf](https://www.yuque.com/attachments/yuque/0/2024/pdf/42982692/1735141464001-12672be9-2dcd-4a66-b42c-d3dc8d05c3e6.pdf)

[《OpenAI o1大模型》中文技术报告.pdf](https://www.yuque.com/attachments/yuque/0/2024/pdf/42982692/1735141463882-74f7ce20-9ac4-406d-b009-ead67f820cfd.pdf)

OpenAI-o1 的复现报告博主: Jian Hu

像**Kimi K0-Math**、**DeepSeek R1 Lite** 和 **Qwen QwQ** 等模型的发布,将OpenAI的O1模型复制问题推到了聚光灯下,引发了AI社区的广泛讨论.

两个月前,我启动了一个开源项目,名为[Awesome-LLM-Strawberry](https://github.com/hijkzzz/Awesome-LLM-Strawberry),这是一个精心策划的资源集合,涵盖了关于OpenAI O1模型复制策略和推理技术的研究论文、博客和项目. 该仓库在GitHub上已获得超过**5000个星标**.

[GitHub - hijkzzz/Awesome-LLM-Strawberry: A collection of LLM papers, blogs, and projects, with a focus on OpenAI o1  and reasoning techniques.](https://github.com/hijkzzz/Awesome-LLM-Strawberry)

“一个聚焦于OpenAI O1模型和推理技术的LLM论文、博客和项目集合. "

通过深入研究相关文献并与专家合作,我整理并提出了几种可能的策略,用于复制O1模型. 本文将概述这些发现,供进一步探索.

[Notion – The all-in-one workspace for your notes, tasks, wikis, and databases.](https://hijkzzz.notion.site/exploring-openai-o1-model-replication)

## 2. 复现 O1模型

该项目的核心开发团队主要由上海交通大学 GAIR 研究组大三、大四本科生和大一博士生组成,并得到了纽约大学、穆罕默德·本·扎耶德人工智能大学等大型语言模型领域顶尖研究科学家的指导.

[GitHub - GAIR-NLP/O1-Journey: O1 Replication Journey: A Strategic Progress Report – Part I](https://github.com/GAIR-NLP/O1-Journey#about-the-team%E3%80%82)

## 3. >STILL: Slow Thinking with LLMs 类O1系统

[GitHub - RUCAIBox/Slow_Thinking_with_LLMs: A series of technical report on Slow Thinking with LLM](https://github.com/RUCAIBox/Slow_Thinking_with_LLMs)

[https://arxiv.org/pdf/2412.09413](https://arxiv.org/pdf/2412.09413)

## 4. 其他的技术报告

[【清华北大腾讯等】联合综述OpenAI o1背后的自博弈(Self-Play)方法原理与技术细节](https://mp.weixin.qq.com/s/uFjDgxc_Gy7DyRZ0e9ttNQ)