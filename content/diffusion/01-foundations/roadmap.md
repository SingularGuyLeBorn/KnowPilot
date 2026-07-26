---
title: "扩散模型：从 DDPM 到 Sora 的路线图"
category: "基础理论"
tags:
  - "diffusion"
  - "roadmap"
  - "overview"
  - "DDPM"
  - "Stable Diffusion"
  - "Sora"
published: true
excerpt: "扩散模型领域总览：从 DDPM 奠基到 Sora 视频生成的完整路线图，含时间线、核心范式速览和工具链。"
---
> **概述**：本文是扩散模型知识库的总路线图，俯瞰整个领域的核心脉络——从 DDPM 奠基、到 Latent Diffusion 工程化、再到 Sora 等视频生成前沿。适合刚入门或想快速建立全局视野的读者。

## 1. 为什么是扩散模型？

扩散模型（Diffusion Models）自 2020 年 DDPM（Denoising Diffusion Probabilistic Models）重新崛起以来，迅速取代 GAN 成为**生成式 AI 的主流范式**。其核心思想简单优雅：

> **前向过程**：逐步对数据加噪声，直到变成纯噪声。  
> **反向过程**：学习逐步去噪，从纯噪声中恢复数据。

扩散模型的优势：
- **训练稳定**：不像 GAN 需要对抗训练，不易模式崩塌
- **覆盖度高**：生成多样性好，几乎覆盖全部数据分布
- **扩展性强**：参数规模、数据规模可自然扩展

---

## 2. 发展时间线

| 年份 | 里程碑 | 贡献 |
|------|--------|------|
| 2015 | **DDPM 雏形**（Sohl-Dickstein） | 提出扩散概率模型框架 |
| 2019 | **NCSN**（Song & Ermon） | 分数匹配 + Langevin 采样 |
| 2020 | **DDPM**（Ho et al.） | 简化损失函数，ImageNet 惊艳结果 |
| 2021 | **DDIM**（Song et al.） | 确定性采样，加速 10-50× |
| 2021 | **Guided Diffusion**（Dhariwal & Nichol） | 分类器/无分类器引导 |
| 2022 | **Latent Diffusion / Stable Diffusion**（Rombach et al.） | 在潜空间扩散，开源生态爆发 |
| 2022 | **DALL·E 2 & Imagen** | 大模型文生图 |
| 2023 | **DPM-Solver / LCM** | 采样加速至 1-4 步 |
| 2023 | **DiT**（Peebles & Xie） | Transformer 替代 U-Net |
| 2024 | **Sora**（OpenAI） | 视频扩散 Transformer |
| 2024 | **Rectified Flow / Consistency Models** | 新范式探索 |

---

## 3. 核心范式速览

### 3.1 DDPM（Denoising Diffusion Probabilistic Models）

$$
x_t = \sqrt{\bar\alpha_t}\, x_0 + \sqrt{1 - \bar\alpha_t}\,\epsilon
$$

训练目标：预测加入的噪声 $\epsilon$

$$
\mathcal{L} = \mathbb{E}_{t,x_0,\epsilon}\left[ \|\epsilon - \epsilon_\theta(x_t, t)\|^2 \right]
$$

> 🔗 详细推导见 [01-foundations/ddpm](./ddpm)

### 3.2 DDIM（Denoising Diffusion Implicit Models）

DDIM 将反向过程变为确定性的，支持跳步采样，速度提升 10-50× 且质量几乎无损。

### 3.3 Latent Diffusion（Stable Diffusion）

在 VAE 潜空间做扩散，大幅降低计算量。SD 开源后催生了 LoRA、ControlNet、ComfyUI 等生态。

$$
\text{VAE: } x \rightarrow z \quad \rightarrow \quad \text{UNet denoise in latent space} \quad \rightarrow \quad z \rightarrow x
$$

### 3.4 DiT（Diffusion Transformer）

用 Transformer 替换 U-Net，随算力扩展效果更好，是 Sora 的基石。

---

## 4. 常用工具链

| 工具 | 用途 | 官方 |
|------|------|------|
| 🧩 **HuggingFace Diffusers** | 训练与推理 Python 库 | [huggingface.co/docs/diffusers](https://huggingface.co/docs/diffusers) |
| 🎨 **ComfyUI** | 节点式工作流 | [github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) |
| 🖌 **Stable Diffusion WebUI** | 一键式界面 | [github.com/AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) |
| 📐 **Kohya_ss** | LoRA/DreamBooth 训练 | [github.com/bmaltais/kohya_ss](https://github.com/bmaltais/kohya_ss) |
| 🧠 **OneDiff / TensorRT** | 推理加速 | 企业级优化 |
| 🔄 **DPM-Solver / LCM** | 快速采样器 | Diffusers 内置 |

---

## 5. 本库资源导航

| 文章 | 说明 |
|------|------|
| [🚀 DDPM 原理与推导](./ddpm) | 从零推导 DDPM |
| [📖 术语对照表](../glossary) | 常用术语速查 |
| [📐 U-Net 架构](./unet) | UNet 2D / 3D 详解 |
| [⚡ 采样加速：DDIM 与 DPM-Solver](./ddim) | 如何又快又好？ |
| [🖼️ 文生图实战](./text2image) | SD / DALL·E / Imagen 对比 |
| [🔧 ControlNet & LoRA](./controlnet) | 可控生成实战 |

> **TODO**：以上链接指向的文章正在逐步补齐。点击可跳转至已完成的篇目。

---

## 推荐下一步

1. 如果你是 **零基础** → 先看 [术语对照表](../glossary) + [DDPM 原理](./ddpm)
2. 如果你是 **动手派** → 直接看 [ControlNet 实战](../05-engineering/controlnet) + [ComfyUI 入门](../05-engineering/comfyui)
3. 如果你是 **前沿猎手** → 直奔 [Sora 解读](../06-frontier/sora) + [DiT 架构](../02-architectures/transformer)

> 🧪 *本路线图会随知识库内容的扩充持续更新。*

