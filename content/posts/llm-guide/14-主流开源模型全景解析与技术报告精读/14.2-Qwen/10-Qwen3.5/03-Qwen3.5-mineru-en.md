---
title: "Qwen3.5 - Source Notes (EN)"
source: "https://qwen.ai/blog?id=qwen3.5"
source_type: "official blog announcement"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.5: Accelerating Productivity with Native Multimodal Agents

> [Back to 14.2-Qwen family overview](../../14.2-Qwen.md)

## Source note

Qwen3.5 does not have a standalone public technical report PDF in this directory. The available source material is the official blog post published on 2026-02-16, preserved under `pdfs/Qwen3.5.html`.

This English delivery file is therefore not a MinerU extraction from a paper PDF. Instead, it is a cleaned source-note document that captures the main technical claims needed for D4 translation and D5 indexing.

## Introduction

We are excited to officially release Qwen3.5, and to open-weight the first model in the series: Qwen3.5-397B-A17B. As a native vision-language model, Qwen3.5-397B-A17B performs strongly across reasoning, coding, agent, and multimodal understanding benchmarks, helping developers and enterprises improve productivity.

The model uses a hybrid architecture that combines Gated Delta Networks (linear attention) with sparse Mixture-of-Experts (MoE). It has 397B total parameters and activates only 17B parameters per forward pass, optimizing speed and cost while preserving capability. Language and dialect support expands from 119 to 201.

Qwen3.5-Plus is the API version served through Alibaba Cloud Bailian, offering a 1M-token context window, official tools, and adaptive invocation.

## 1 Model Performance

We evaluate Qwen3.5 against frontier models across multiple tasks and modalities.

### 1.1 Natural Language Benchmarks

| Benchmark | GPT-5.2 | Claude 4.5 Opus | Gemini-3 Pro | Qwen3-Max-Thinking | K2.5-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Knowledge & Reasoning** |
| MMLU-Pro | 87.4 | 89.5 | 89.8 | 85.7 | 87.1 | 87.8 |
| MMLU-Redux | 95.0 | 95.6 | 95.9 | 92.8 | 94.5 | 94.9 |
| SuperGPQA | 67.9 | 70.6 | 74.0 | 67.3 | 69.2 | 70.4 |
| C-Eval | 90.5 | 92.2 | 93.4 | 93.7 | 94.0 | 93.0 |
| **Instruction Following** |
| IFEval | 94.8 | 90.9 | 93.5 | 93.4 | 93.9 | 92.6 |
| IFBench | 75.4 | 58.0 | 70.4 | 70.9 | 70.2 | 76.5 |
| MultiChallenge | 57.9 | 54.2 | 64.2 | 63.3 | 62.7 | 67.6 |
| **Long Context** |
| AA-LCR | 72.7 | 74.0 | 70.7 | 68.7 | 70.0 | 68.7 |
| LongBench v2 | 54.5 | 64.4 | 68.2 | 60.6 | 61.0 | 63.2 |
| **STEM** |
| GPQA | 92.4 | 87.0 | 91.9 | 87.4 | 87.6 | 88.4 |
| HLE | 35.5 | 30.8 | 37.5 | 30.2 | 30.1 | 28.7 |
| HLE-Verified | 43.3 | 38.8 | 48.0 | 37.6 | -- | 37.6 |
| **Reasoning** |
| LiveCodeBench v6 | 87.7 | 84.8 | 90.7 | 85.9 | 85.0 | 83.6 |
| HMMT Feb 25 | 99.4 | 92.9 | 97.3 | 98.0 | 95.4 | 94.8 |
| HMMT Nov 25 | 100 | 93.3 | 93.3 | 94.7 | 91.1 | 92.7 |
| IMOAnswerBench | 86.3 | 84.0 | 83.3 | 83.9 | 81.8 | 80.9 |
| AIME26 | 96.7 | 93.3 | 90.6 | 93.3 | 93.3 | 91.3 |
| **General Agent** |
| BFCL-V4 | 63.1 | 77.5 | 72.5 | 67.7 | 68.3 | 72.9 |
| TAU2-Bench | 87.1 | 91.6 | 85.4 | 84.6 | 77.0 | 86.7 |
| VITA-Bench | 38.2 | 56.3 | 51.6 | 40.9 | 41.9 | 49.7 |
| DeepPlanning | 44.6 | 33.9 | 23.3 | 28.7 | 14.5 | 34.3 |
| Tool Decathlon | 43.8 | 43.5 | 36.4 | 18.8 | 27.8 | 38.3 |
| MCP-Mark | 57.5 | 42.3 | 53.9 | 33.5 | 29.5 | 46.1 |
| **Search Agent** |
| HLE w/ tool | 45.5 | 43.4 | 45.8 | 49.8 | 50.2 | 48.3 |
| BrowseComp | 65.8 | 67.8 | 59.2 | 53.9 | --/74.9 | 69.0/78.6 |
| BrowseComp-zh | 76.1 | 62.4 | 66.8 | 60.9 | -- | 70.3 |
| WideSearch | 76.8 | 76.4 | 68.0 | 57.9 | 72.7 | 74.0 |
| Seal-0 | 45.0 | 47.7 | 45.5 | 46.9 | 57.4 | 46.9 |
| **Multilingual** |
| MMMLU | 89.5 | 90.1 | 90.6 | 84.4 | 86.0 | 88.5 |
| MMLU-ProX | 83.7 | 85.7 | 87.7 | 78.5 | 82.3 | 84.7 |
| NOVA-63 | 54.6 | 56.7 | 56.7 | 54.2 | 56.0 | 59.1 |
| INCLUDE | 87.5 | 86.2 | 90.5 | 82.3 | 83.3 | 85.6 |
| Global PIQA | 90.9 | 91.6 | 93.2 | 86.0 | 89.3 | 89.8 |
| PolyMATH | 62.5 | 79.0 | 81.6 | 64.7 | 43.1 | 73.3 |
| WMT24++ | 78.8 | 79.7 | 80.7 | 77.6 | 77.6 | 78.9 |
| MAXIFE | 88.4 | 79.2 | 87.5 | 84.0 | 72.8 | 88.2 |
| **Coding Agent** |
| SWE-bench Verified | 80.0 | 80.9 | 76.2 | 75.3 | 76.8 | 76.4 |
| SWE-bench Multilingual | 72.0 | 77.5 | 65.0 | 66.7 | 73.0 | 69.3 |
| SecCodeBench | 68.7 | 68.6 | 62.4 | 57.5 | 61.3 | 68.3 |
| Terminal Bench 2 | 54.0 | 59.3 | 54.2 | 22.5 | 50.8 | 52.5 |

> Table 1: Comparison of Qwen3.5-397B-A17B with frontier models on natural language tasks. Data from the official blog, evaluated in February 2026.

**Benchmark notes:**

- HLE-Verified: a verified revision of Humanity's Last Exam with transparent per-component validation.
- TAU2-Bench: evaluated with the aviation-domain correction from Claude Opus 4.5 system card.
- MCP-Mark: GitHub MCP server uses api.githubcopilot.com v0.30.3; Playwright tool responses truncated to 32k tokens.
- Search agents: most search agents built on our model use a simple context-folding strategy (256k).
- BrowseComp: 69.0 with simple context folding; 78.6 with discard-all strategy (same as DeepSeek-V3.2 and Kimi K2.5).
- WideSearch: 256k context window, no context management.
- MMLU-ProX: average accuracy across 29 languages.
- WMT24++: harder rebalanced subset of WMT24; average XCOMET-XXL score across 55 languages.
- MAXIFE: accuracy on English plus multilingual original prompts (23 settings).
- Empty cells (--) indicate scores not yet available or not applicable.

### 1.2 Vision-Language Benchmarks

| Benchmark | GPT-5.2 | Claude 4.5 Opus | Gemini-3 Pro | Qwen3-VL-235B-A22B | K2.5-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM & Puzzles** |
| MMMU | 86.7 | 80.7 | 87.2 | 80.6 | 84.3 | 85.0 |
| MMMU-Pro | 79.5 | 70.6 | 81.0 | 69.3 | 78.5 | 79.0 |
| MathVision | 83.0 | 74.3 | 86.6 | 74.6 | 84.2 | 88.6 |
| Mathvista(mini) | 83.1 | 80.0 | 87.9 | 85.8 | 90.1 | 90.3 |
| We-Math | 79.0 | 70.0 | 86.9 | 74.8 | 84.7 | 87.9 |
| DynaMath | 86.8 | 79.7 | 85.1 | 82.8 | 84.4 | 86.3 |
| ZEROBench | 9 | 3 | 10 | 4 | 9 | 12 |
| ZEROBench_sub | 33.2 | 28.4 | 39.0 | 28.4 | 33.5 | 41.0 |
| BabyVision | 34.4 | 14.2 | 49.7 | 22.2 | 36.5 | 52.3/43.3 |
| **General VQA** |
| RealWorldQA | 83.3 | 77.0 | 83.3 | 81.3 | 81.0 | 83.9 |
| MMStar | 77.1 | 73.2 | 83.1 | 78.7 | 80.5 | 83.8 |
| HallusionBench | 65.2 | 64.1 | 68.6 | 66.7 | 69.8 | 71.4 |
| MMBenchEN-DEV-v1.1 | 88.2 | 89.2 | 93.7 | 89.7 | 94.2 | 93.7 |
| SimpleVQA | 55.8 | 65.7 | 73.2 | 61.3 | 71.2 | 67.1 |
| **OCR & Document Understanding** |
| OmniDocBench1.5 | 85.7 | 87.7 | 88.5 | 84.5 | 88.8 | 90.8 |
| CharXiv(RQ) | 82.1 | 68.5 | 81.4 | 66.1 | 77.5 | 80.8 |
| MMLongBench-Doc | -- | 61.9 | 60.5 | 56.2 | 58.5 | 61.5 |
| CC-OCR | 70.3 | 76.9 | 79.0 | 81.5 | 79.7 | 82.0 |
| AI2D_TEST | 92.2 | 87.7 | 94.1 | 89.2 | 90.8 | 93.9 |
| OCRBench | 80.7 | 85.8 | 90.4 | 87.5 | 92.3 | 93.1 |
| **Spatial Intelligence** |
| ERQA | 59.8 | 46.8 | 70.5 | 52.5 | -- | 67.5 |
| CountBench | 91.9 | 90.6 | 97.3 | 93.7 | 94.1 | 97.2 |
| RefCOCO(avg) | -- | -- | 84.1 | 91.1 | 87.8 | 92.3 |
| ODInW13 | -- | -- | 46.3 | 43.2 | -- | 47.0 |
| EmbSpatialBench | 81.3 | 75.7 | 61.2 | 84.3 | 77.4 | 84.5 |
| RefSpatialBench | -- | -- | 65.5 | 69.9 | -- | 73.6 |
| LingoQA | 68.8 | 78.8 | 72.8 | 66.8 | 68.2 | 81.6 |
| V* | 75.9 | 67.0 | 88.0 | 85.9 | 77.0 | 95.8/91.1 |
| Hypersim | -- | -- | -- | 11.0 | -- | 12.5 |
| SUNRGBD | -- | -- | -- | 34.9 | -- | 38.3 |
| Nuscene | -- | -- | -- | 13.9 | -- | 16.0 |
| **Video Understanding** |
| VideoMME(w sub.) | 86 | 77.6 | 88.4 | 83.8 | 87.4 | 87.5 |
| VideoMME(w/o sub.) | 85.8 | 81.4 | 87.7 | 79.0 | 83.2 | 83.7 |
| VideoMMMU | 85.9 | 84.4 | 87.6 | 80.0 | 86.6 | 84.7 |
| MLVU (M-Avg) | 85.6 | 81.7 | 83.0 | 83.8 | 85.0 | 86.7 |
| MVBench | 78.1 | 67.2 | 74.1 | 75.2 | 73.5 | 77.6 |
| LVBench | 73.7 | 57.3 | 76.2 | 63.6 | 75.9 | 75.5 |
| MMVU | 80.8 | 77.3 | 77.5 | 71.1 | 80.4 | 75.4 |
| **Vision Agent** |
| ScreenSpot Pro | -- | 45.7 | 72.7 | 62.0 | -- | 65.6 |
| OSWorld-Verified | 38.2 | 66.3 | -- | 38.1 | 63.3 | 62.2 |
| AndroidWorld | -- | -- | -- | 63.7 | -- | 66.8 |
| **Medical VQA** |
| SLAKE | 76.9 | 76.4 | 81.3 | 72.5 | 81.6 | 79.9 |
| PMC-VQA | 58.9 | 59.9 | 62.3 | 56.1 | 63.3 | 64.2 |
| MedXpertQA-MM | 73.3 | 63.6 | 76.0 | 47.6 | 65.3 | 70.0 |

> Table 2: Comparison of Qwen3.5-397B-A17B with frontier models on vision-language tasks.

**Benchmark notes:**

- MathVision: our model evaluated with fixed prompt "Please reason step by step, and put your final answer within \\boxed{}".
- BabyVision: score with Code Interpreter enabled; 43.3 without CI.
- V*: score with Code Interpreter enabled; 91.1 without CI.
- Empty cells (--) indicate scores not yet available or not applicable.

### 1.3 Post-training Performance Gains

Relative to Qwen3, Qwen3.5's post-training gains mainly come from broad expansion of RL tasks and environments. We emphasize RL environment difficulty and generalization rather than narrow benchmark tuning.

Figure 1 shows agent capability gains from RL environment scaling. Overall performance is computed as average rank across BFCL-V4, VITA-Bench, DeepPlanning, Tool-Decathlon, and MCP-Mark. More scaling results will be detailed in an upcoming technical report.

> Figure 1: Qwen3.5 general agent capability gains from RL environment scaling. (Original blog uses a dynamic chart; core conclusion: RL environment scaling yields substantial agent generalization gains.)

## 2 Pre-training

Qwen3.5 advances pre-training along three dimensions: power, efficiency, and versatility.

**Power.** Trained on larger-scale vision-text corpora with stronger Chinese, English, multilingual, STEM, and reasoning data and stricter filtering. Qwen3.5-397B-A17B matches Qwen3-Max-Base (>1T parameters).

**Efficiency.** Built on Qwen3-Next architecture: higher-sparsity MoE, Gated DeltaNet + Gated Attention hybrid attention, stability optimizations, and multi-token prediction. At 32k/256k context, Qwen3.5-397B-A17B decoding throughput is 8.6x/19.0x Qwen3-Max with comparable performance; 3.5x/7.2x Qwen3-235B-A22B.

**Versatility.** Native multimodality via early text-vision fusion and expanded vision/STEM/video data, outperforming Qwen3-VL at similar scale. Multilingual coverage expands from 119 to 201 languages/dialects; 250k vocabulary (vs 150k) yields ~10-60% encoding/decoding efficiency gains on most languages.

### 2.1 Base Model Performance

| Benchmark | Qwen3-235B-A22B | GLM-4.5-355B-A32B | DeepSeek-V3.2-671B-A37B | K2-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|
| **General Knowledge & Multilingual** |
| MMLU | 87.33 | 86.56 | 88.11 | 87.38 | 88.61 |
| MMLU-Pro | 67.73 | 65.00 | 62.82 | 67.64 | 76.01 |
| MMLU-Redux | 87.44 | 86.86 | 87.29 | 86.65 | 89.09 |
| SuperGPQA | 42.84 | 44.56 | 43.46 | 44.86 | 57.96 |
| C-Eval | 91.82 | 85.50 | 90.48 | 91.82 | 91.82 |
| MMMLU | 81.27 | 82.26 | 83.20 | 82.26 | 85.82 |
| Include | 75.26 | 73.41 | 76.52 | 72.05 | 79.27 |
| Nova | 66.52 | 60.96 | 60.40 | 61.44 | 67.55 |
| **Reasoning & STEM** |
| BBH | 87.95 | 87.68 | 86.03 | 89.11 | 90.98 |
| KoRBench | 50.80 | 52.80 | 54.00 | 53.84 | 54.08 |
| GPQA | 47.47 | 44.63 | 44.16 | 46.78 | 54.64 |
| MATH | 71.84 | 61.84 | 64.40 | 71.50 | 74.14 |
| GSM8K | 91.17 | 89.31 | 89.12 | 92.12 | 93.71 |
| **Coding** |
| Evalplus | 77.60 | 69.49 | 62.68 | 71.77 | 79.32 |
| MultiPLE | 65.94 | 62.51 | 61.88 | 70.64 | 79.39 |
| SWE-agentless | 31.77 | 29.23 | 34.67 | 28.54 | 43.26 |
| CRUX-I | 64.25 | 67.63 | 63.25 | 70.50 | 71.13 |
| CRUX-O | 78.88 | 77.13 | 73.88 | 77.13 | 82.38 |

> Table 3: Qwen3.5-397B-A17B base model comparison with peer open/closed base models.

## 3 Infrastructure

Qwen3.5 uses heterogeneous infrastructure for efficient native multimodal training: decoupled parallel strategies for vision and language components avoid unified-strategy inefficiency. Sparse activation enables cross-module compute overlap, achieving near-100% training throughput on mixed text-image-video data vs pure-text baseline.

Native FP8 pipeline applies low precision to activations, MoE routing, and GEMM with runtime monitoring and BF16 fallback on sensitive layers, reducing activation memory ~50% and accelerating >10%, scaling stably to trillions of tokens.

We built a scalable asynchronous RL framework supporting full-size Qwen3.5 across text, multimodal, and multi-turn interaction. Train-inference separation improves hardware utilization with dynamic load balancing and fine-grained fault recovery. FP8 train/infer, rollout routing replay, speculative sampling, and multi-turn rollout locking further optimize throughput and train-infer consistency. System-algorithm co-design controls sample staleness, mitigates data long-tail, and stabilizes training curves. The framework supports native agent workflows with seamless multi-turn environment interaction, scaling to million-scale agent scaffolds and environments. End-to-end acceleration: 3-5x.

## 4 Getting Started with Qwen3.5

### 4.1 Interacting with Qwen3.5

Qwen Chat offers auto, thinking, and fast modes. Auto mode supports adaptive thinking with search and code interpreter tools; thinking mode performs deep reasoning on hard problems; fast mode answers directly without thinking tokens.

### 4.2 Alibaba Cloud Bailian

Call Qwen3.5-Plus via Bailian. Enable advanced capabilities with:

- `enable_thinking`: chain-of-thought reasoning mode
- `enable_search`: web search and Code Interpreter

Compatible OpenAI API example uses `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` with streaming `reasoning_content` and `content` fields.

Integrate with Qwen Code, Claude Code, Cline, OpenClaw, OpenCode for vibe coding.

## 5 Demo Capabilities

### 5.1 Code and Agents

Qwen3.5 assists web development, especially frontend/UI tasks. Integrates with OpenClaw for search, information gathering, and structured reports. Qwen Code supports vibe coding from natural language to iterative development.

### 5.2 Vision Agents

Qwen3.5 operates as a vision agent on mobile and PC, handling cross-app workflows, sketch-to-code conversion, game video logic reconstruction, and long-video summarization into structured pages or charts. Pixel-level spatial modeling supports counting, relative positioning, and embodied applications.

### 5.3 Visual Reasoning

Compared to Qwen3-VL, Qwen3.5 is more robust on STEM visual reasoning. Native code-level image processing supports cropping, annotation, and enhancement for finer analysis.

## 6 Multilingual Capabilities

Qwen3.5 supports 200+ languages and dialects (201 listed), expanding low-resource language coverage for global AI accessibility.

| Language Family | Languages and Dialects |
|:---|:---|
| 印欧语系 | 英语、法语、葡萄牙语、德语、罗马尼亚语、瑞典语、丹麦语、保加利亚语、俄语、捷克语、希腊语、乌克兰语、西班牙语、荷兰语、斯洛伐克语、克罗地亚语、波兰语、立陶宛语、挪威语(博克马尔语)、挪威尼诺斯克语、波斯语、斯洛文尼亚语、古吉拉特语、拉脱维亚语、意大利语、奥克语、尼泊尔语、马拉地语、白俄罗斯语、塞尔维亚语、卢森堡语、威尼斯语、阿萨姆语、威尔士语、西里西亚语、阿斯图里亚语、恰蒂斯加尔语、阿瓦德语、迈蒂利语、博杰普尔语、信德语、爱尔兰语、法罗语、印地语、旁遮普语、孟加拉语、奥里雅语、塔吉克语、东意第绪语、伦巴第语、利古里亚语、西西里语、弗留利语、撒丁岛语、加利西亚语、加泰罗尼亚语、冰岛语、托斯克语、阿尔巴尼亚语、林堡语、达里语、南非荷兰语、马其顿语、僧伽罗语、乌尔都语、马加希语、波斯尼亚语、亚美尼亚语、拉特加利亚语、苏格兰盖尔语、中库尔德语、北库尔德语、南普什图语、梵语、敦达里语、马尔瓦里语、阿希拉尼语、巴盖利语、巴格里语、本德利语、布拉吉语、库马翁语、克什米尔语 |
| 汉藏语系 | 中文(简体中文、繁体中文、粤语)、缅甸语、藏语、梅泰语 |
| 亚非语系 | 阿拉伯语(标准语、内志语、黎凡特语、埃及语、摩洛哥语、美索不达米亚语、塔伊兹-阿德尼语、突尼斯语、海湾语、阿尔及利亚语、苏丹语、利比亚语)、希伯来语、马耳他语、阿姆哈拉语、提格里尼亚语、卡比尔语、索马里语、西中奥罗莫语、豪萨语 |
| 南岛语系 | 印度尼西亚语、马来语、他加禄语、宿务语、爪哇语、巽他语、米南加保语、巴厘岛语、班加语、邦阿西楠语、伊洛科语、瓦雷语(菲律宾)、高原马达加斯加语、马达加斯加语、布吉语、毛利语、萨摩亚语、夏威夷语、斐济语 |
| 德拉威语 | 泰米尔语、泰卢固语、卡纳达语、马拉雅拉姆语 |
| 突厥语系 | 土耳其语、北阿塞拜疆语、北乌兹别克语、哈萨克语、巴什基尔语、鞑靼语、克里米亚鞑靼语、吉尔吉斯语、土库曼语、维吾尔语 |
| 壮侗语系 | 泰语、老挝语、掸语 |
| 乌拉尔语系 | 芬兰语、爱沙尼亚语、匈牙利语、草原马里语 |
| 南亚语系 | 越南语、高棉语 |
| 尼日尔-刚果语系 | 约鲁巴语、埃维语、卢旺达语、林加拉语、北索托语、尼扬贾语、绍纳语、南索托语、茨瓦纳语、科萨语、祖鲁语、卢干达语、斯瓦蒂语、聪加语、通布卡语、文达语、乔奎语、卢巴-卡赛语、隆迪语、姆本杜语、基库尤语、刚果语、尼日利亚富拉语、沃洛夫语、丰语、卡比耶语、莫西语、阿坎语、特维语、班巴拉语、伊博语 |
| 其他 | 日语、韩语、格鲁吉亚语、巴斯克语、海地语、帕皮阿门托语、卡布维尔迪亚努语、托克皮辛语、斯瓦希里语、中部艾马拉语、图卢语、那加语、尼日利亚皮钦语、毛里求斯克里奥尔语、桑戈语、阿亚库乔克丘亚语、喀尔喀蒙古语、西南丁卡语、努埃尔语、瓜拉尼语 |

> Table 4: Languages and dialects supported by Qwen3.5 (201 total).

## 7 Summary and Future Work

Qwen3.5's efficient hybrid architecture and native multimodal reasoning lay groundwork for general digital agents. Next focus shifts from scale to system integration: cross-session persistent memory, embodied interfaces for real-world interaction, and self-improvement mechanisms toward long-running, logically consistent systems.

## Citation

```bibtex
@misc{qwen35blog,
    title = {Qwen3.5: Accelerating Productivity with Native Multimodal Agents},
    url = {https://qwen.ai/blog?id=qwen3.5},
    author = {Qwen Team},
    month = {February},
    year = {2026}
}
```
