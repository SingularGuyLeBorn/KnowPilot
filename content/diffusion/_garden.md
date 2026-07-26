---
title: 扩散模型
description: 从 DDPM 到 Sora——扩散模型原理、实现、应用与前沿追踪
---
# 🌊 扩散模型（Diffusion Models）知识库

> 从 DDPM 到 Sora——系统梳理扩散模型的数学原理、工程实现、生态工具与前沿进展。

## 本库定位

面向**想系统学习 / 快速上手 / 追踪前沿**的 AI 研究者和工程师。内容涵盖：

- **理论基础**：DDPM、Score Matching、SDE/ODE 视角
- **经典模型**：DDPM、DDIM、LDM（Stable Diffusion）、DALL·E、Imagen
- **加速方法**：DDIM、DPM-Solver、LCM、Adversarial Diffusion
- **应用领域**：文生图、视频生成（Sora/Stable Video Diffusion）、3D 生成、语音合成
- **工程实践**：Diffusers、ComfyUI、LoRA、ControlNet 训练与部署

---

## 📂 推荐目录结构

```
diffusion/               ← 本库根
├── 01-foundations/      ← 基础理论
│   ├── ddpm            — DDPM 原理与推导
│   ├── score-matching  — 分数匹配与 SDE
│   └── conditioned     — 条件扩散与引导
├── 02-architectures/    ← 模型架构
│   ├── unet            — U-Net 骨干
│   ├── transformer     — DiT 与 Transformer
│   └── vae             — VAE / VQ-VAE 前置
├── 03-samplers/         ← 采样加速
│   ├── ddim            — DDIM 确定性采样
│   ├── dpm-solver      — DPM-Solver 快速采样
│   └── lcm             — Latent Consistency Model
├── 04-applications/     ← 应用实践
│   ├── text2image      — 文生图（SD / DALL·E / Imagen）
│   ├── video           — 视频生成（Sora / SVD）
│   ├── 3d              — 3D 生成（DreamFusion / 3DGS）
│   └── audio           — 语音生成（AudioLDM）
├── 05-engineering/      ← 工程实战
│   ├── diffusers       — HuggingFace Diffusers
│   ├── controlnet      — ControlNet 使用与训练
│   ├── lora            — LoRA 微调
│   └── comfyui         — ComfyUI 工作流
├── 06-frontier/         ← 前沿追踪
│   ├── sora            — Sora 架构解读
│   ├── rectified-flow  — Rectified Flow
│   └── consistency     — Consistency Models
└── glossary             — 术语对照表
```

## 📖 推荐阅读顺序

```
入门路线（绿色通道）：
  ① glossary（术语表）
  ② 01-foundations/ddpm
  ③ 02-architectures/unet
  ④ 01-foundations/conditioned
  ⑤ 04-applications/text2image（大势感知）

进阶路线：
  ⑥ 01-foundations/score-matching
  ⑦ 03-samplers/ddim → dpm-solver → lcm
  ⑧ 02-architectures/transformer（DiT）
  ⑨ 05-engineering/controlnet → lora

前沿路线：
  ⑩ 06-frontier/sora → rectified-flow → consistency
  ⑪ 04-applications/video → 3d → audio
```

---

## ✍️ 如何往本库写文章？

通过管理 Agent 或直接找我，用 `post_create(garden="diffusion", slug="...")` 即可。

**文章规范：**
- 每篇文章应是**自包含**的知识点（可跨篇引用）
- 开头用 `> **概述**：一两句话说明本篇内容`
- 数学公式用 `$$` 块级 / `$` 行内
- 代码示例用 `python` 标注
- 每篇末尾附「进一步阅读」链接

**快速贡献**：想写某篇但还没时间？先建骨架（带 `TODO`），后续再补全。

---

> 🌱 知识如扩散，每一步加噪，每一步去噪，终见清晰的风景。
