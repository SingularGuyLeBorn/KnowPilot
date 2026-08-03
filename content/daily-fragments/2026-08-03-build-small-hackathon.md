

---
title: 2026-08-03 碎片：Build Small Hackathon 四个获奖项目
category: 灵感收集
published: false
excerpt: >-
  OpenBMB × Hugging Face Build Small Hackathon（≤32B 小模型）获奖项目精选 4
  个：Aranya、WanderLust、Grandpa's Bedtime Stories、Aether Garden
tags:
  - 小模型
  - hackathon
  - MiniCPM
  - 创意项目
  - AR
  - 语音
---
# 2026-08-03 碎片：Build Small Hackathon 四个获奖项目

> 来源：[小模型，大作品：OpenBMB × Hugging Face Build Small Hackathon 获奖项目揭晓](https://mp.weixin.qq.com/s/uPQpQvMa0uAoeCG9ZmRt8w)（OpenBMB 开源社区）
> 状态：已初步整理，待后续决定是否归入正式知识库

**赛事背景**：Hugging Face × Gradio 发起、OpenBMB 赞助的 Build Small Hackathon，限定只能使用总参数 ≤32B 的小模型，构建 Gradio App 部署到 HF Spaces。共 946 个可运行应用、817 位开发者，263 个项目用了 MiniCPM（第二大热门模型家族），74 支团队自行微调发布了定制模型。

---

## 1. Aranya: A WildKeeper's Adventure（二等奖）——可听见的丛林探险

- **一句话**：把植物识别变成一场可以听见的丛林探险
- **功能**：植物识别 + 健康分析 + 养护建议 + 语音讲解
- **技术**：MiniCPM-V 4.6 微调出两个专用模型（物种识别、健康分析）；llama.cpp + Pocket TTS 做本地推理和语音
- **亮点**：不止"拍照识别"，加了听觉维度，让识别变成沉浸式体验
- 链接：https://huggingface.co/spaces/build-small-hackathon/aranya_a_wildkeepers_adventure

## 2. WanderLust（三等奖）——走你真正会喜欢的路

- **一句话**：不只带你走最快的路，而是走一条你真正会喜欢的路
- **功能**：本地优先的"氛围路线"规划助手。输入起点终点之外，可描述想要的路线的体验（如"经过书店和安静的小路"、"适合周日上午散步"）
- **技术**：MiniCPM5-1B 理解用户偏好，与 OpenStreetMap + 传统路径规划算法协作生成个性化路线
- **亮点**：偏好理解 × 路径规划的混合范式，本地优先
- 链接：https://huggingface.co/spaces/build-small-hackathon/wanderlust

## 3. Grandpa's Bedtime Stories（二等奖）——照片变成可对话的 AR 故事世界

- **一句话**：让一张普通照片，变成可以进入和对话的 AR 故事世界
- **功能**：上传照片 → 生成 3D Gaussian Splat 场景（WebXR）→ 圈选人物/物体 → 用语音向"爷爷"提问
- **技术**：MiniCPM-o 4.5 一个模型同时完成视觉理解、语音理解、故事生成、语音回答
- **亮点**：静态照片 → 可进入、可询问、可共同讲述的故事世界
- 链接：https://huggingface.co/spaces/build-small-hackathon/grandpas-bedtime-stories

## 4. Aether Garden（二等奖）——会自己继续书写的魔法书

- **一句话**：一本会自己继续书写的魔法书 / 持续生长的 AI 幻想世界
- **功能**：AI 驱动的持续演化幻想世界
- **技术**：MiniCPM3-4B 参与角色生成和世界叙事——模型不是回答问题，而是成为推动世界持续演化的引擎
- **亮点**："持续生长"世界观，模型即世界的叙事引擎
- 链接：https://huggingface.co/spaces/build-small-hackathon/aether-garden

---

## 我的初步观察

- 4 个项目共同的取向：**小模型 + 具体场景 = 真实产品**，不追求通用智能
- 三个方向可留意：①多模态小模型做沉浸交互（Aranya / Grandpa's）②偏好理解 + 外部算法协同（WanderLust）③模型当"世界引擎"而非"问答器"（Aether Garden）
- MiniCPM 系列（V/o/3/5）在端侧 + 多模态 + 创意应用里是主力

*（注：Tianwen｜天问 三等奖项目也用了 MiniCPM5-1B + LoRA，做传统命理自我反思应用，未入选用户精选，记录备查。）*
