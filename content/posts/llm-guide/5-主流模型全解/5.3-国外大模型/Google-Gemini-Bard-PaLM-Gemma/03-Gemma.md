---
title: "Google Gemma"
date: 2026-05-11
tags: []
---

# 03 Google Gemma

## 1. 摘要

Gemma是Google DeepMind推出的轻量级开源大语言模型系列，基于与Gemini相同的技术和架构组件构建，但设计为可在开发者的笔记本电脑和工作站上运行。Gemma系列以"开放、高效、负责任"为核心设计理念，在推动大模型技术民主化方面发挥了重要作用。从Gemma 1到Gemma 3，Google持续优化模型效率和多模态能力，使更多开发者能够使用和定制大语言模型。

## 2. 发展历程

### 2.1 Gemma 1(2024年2月)

- **发布日期**：2024年2月
- **定位**：轻量级开源模型
- **核心技术/特点**：
  - 参数规模：2B和7B
  - 基于Gemini技术构建
  - 支持多种任务：文本生成、摘要、问答等
  - 负责任AI设计：包含安全分类器和过滤机制
- **技术报告**：[Gemma Model Card](https://huggingface.co/google/gemma-7b)

- **关键意义**：降低了AI开发门槛，推动开源社区发展

### 2.2 Gemma 2(2024年6月)

- **发布日期**：2024年6月
- **定位**：性能优化的轻量级模型
- **核心技术/特点**：
  - 参数规模：2B、9B、27B
  - 改进了推理和多语言能力
  - 知识蒸馏技术优化
  - 在同等规模下性能领先
- **技术报告**：[Gemma 2 Model Card](https://huggingface.co/google/gemma-2-9b)

- **关键意义**：提高了开源模型的竞争力

### 2.3 Gemma 3(2025年3月)

- **发布日期**：2025年3月
- **定位**：多模态和多语言支持
- **核心技术/特点**：
  - 参数规模：1B至27B
  - 支持128K token上下文窗口
  - 采用SigLIP视觉Encoder 
  - 支持140+种语言
  - 视觉问答、图像理解能力
- **技术报告**：[Technical Report on Gemma 3](https://arxiv.org/abs/2503.19786)

- **关键意义**：在多模态和长上下文处理方面取得突破

## 3. 模型家族

| 模型 | 参数 | 上下文 | 特点 |
|------|------|--------|------|
| Gemma 1 | 2B/7B | 8K | 初代开源模型 |
| Gemma 2 | 2B/9B/27B | 8K | 性能大幅提升 |
| Gemma 3 | 1B/4B/12B/27B | 128K | 多模态、多语言 |

## 4. 技术特色

### 1. 知识蒸馏

Gemma系列大量采用知识蒸馏技术：
- 从更大的Gemini模型蒸馏知识
- 在保持小参数的同时获得高性能
- 降低训练和推理成本

### 2. 负责任AI

- 预训练数据经过严格筛选
- 包含安全分类器
- 提供模型卡详细说明局限性和风险
- 支持开发者进行安全评估

### 3. 多语言能力

Gemma 3支持超过140种语言：
- 覆盖欧洲、亚洲、非洲主要语言
- 在低资源语言上表现优异
- 多语言翻译和理解能力

### 4. 端侧部署

- 1B和4B模型可在手机端运行
- 支持Android和iOS部署
- 通过MediaPipe等框架集成

## 5. 开源生态

### 5.1 工具链支持

- **Hugging Face Transformers**：原生支持
- **vLLM**：高效推理
- **Ollama**：本地运行
- **TensorFlow Lite**：移动端部署
- **MLX**：Apple Silicon优化

### 5.2 衍生模型

- **CodeGemma**：编程专用模型
- **PaliGemma**：视觉语言模型
- **ShieldGemma**：安全内容检测

## 6. 应用场景

- **教育**：个性化学习助手
- **研究**：学术写作辅助
- **开发**：代码生成和调试
- **创意**：内容创作和头脑风暴
- **移动端**：离线AI助手

## 7. 参考链接

- [Gemma 官方页面](https://ai.google.dev/gemma)
- [Gemma GitHub](https://github.com/google/gemma)
- [Gemma 3 技术报告](https://arxiv.org/abs/2503.19786)
- [Kaggle Gemma 竞赛](https://www.kaggle.com/competitions/gemma)
