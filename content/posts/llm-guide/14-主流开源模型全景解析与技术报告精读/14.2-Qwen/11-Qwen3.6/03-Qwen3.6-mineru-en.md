---
title: "03 · Qwen3.6 - Source Notes (EN)"
source: "https://qwen.ai/blog?id=qwen3.6-35b-a3b / https://qwen.ai/blog?id=qwen3.6-27b"
source_type: "official blog announcement"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.6: Agentic Coding at Every Scale

> [Back to 14.2-Qwen family overview](../../14.2-Qwen.md)

## Source note

Qwen3.6 does not have a standalone public technical report PDF in this directory. Available source material consists of two official blog posts (2026-04-15 for Qwen3.6-35B-A3B, 2026-04-22 for Qwen3.6-27B), preserved under `pdfs/Qwen3.6.html`.

This English file is a cleaned source-note document for D4 translation and D5 indexing, not a MinerU PDF extraction.

## Introduction

Following Qwen3.6-Plus, Qwen Team open-sourced Qwen3.6-35B-A3B and Qwen3.6-27B in April 2026, forming a full-scale Qwen3.6 open family. Both models support multimodal thinking and non-thinking modes and reach flagship-level agentic coding performance.

**Qwen3.6-35B-A3B** is a sparse but capable MoE model: 35B total / 3B activated. Despite efficiency, it excels at agentic coding, surpassing Qwen3.5-35B-A3B and competing with dense models like Qwen3.5-27B and Gemma-4-31B.

**Qwen3.6-27B** is a 27B dense multimodal model—the most requested community size. As dense architecture without MoE routing, it surpasses the prior open flagship Qwen3.5-397B-A17B on agentic coding benchmarks: SWE-bench Verified (77.2 vs 76.2), SWE-bench Pro (53.5 vs 50.9), Terminal-Bench 2.0 (59.3 vs 52.5), SkillsBench (48.2 vs 30.0).

Both models are available on Qwen Studio, via Alibaba Cloud Bailian API, and as open weights.

## 1 Model Performance

### 1.1 Natural Language Benchmarks

#### 1.1.1 Qwen3.6-35B-A3B vs Same-Scale Models

| Benchmark | Qwen3.5-27B | Gemma4-31B | Qwen3.5-35B-A3B | Gemma4-26B-A4B | Qwen3.6-35B-A3B |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Coding Agent** |
| SWE-bench Verified | 75.0 | 52.0 | 70.0 | 17.4 | 73.4 |
| SWE-bench Multilingual | 69.3 | 51.7 | 60.3 | 17.3 | 67.2 |
| SWE-bench Pro | 51.2 | 35.7 | 44.6 | 13.8 | 49.5 |
| Terminal-Bench 2.0 | 41.6 | 42.9 | 40.5 | 34.2 | 51.5 |
| Claw-Eval Avg | 64.3 | 48.5 | 65.4 | 58.8 | 68.7 |
| Claw-Eval Pass^3 | 46.2 | 25.0 | 51.0 | 28.0 | 50.0 |
| SkillsBench Avg5 | 27.2 | 23.6 | 4.4 | 12.3 | 28.7 |
| QwenClawBench | 52.2 | 41.7 | 47.7 | 38.7 | 52.6 |
| NL2Repo | 27.3 | 15.5 | 20.5 | 11.6 | 29.4 |
| QwenWebBench | 1068 | 1197 | 978 | 1178 | 1397 |
| **General Agent** |
| TAU3-Bench | 68.4 | 67.5 | 68.9 | 59.0 | 67.2 |
| VITA-Bench | 41.8 | 43.0 | 29.1 | 36.9 | 35.6 |
| DeepPlanning | 22.6 | 24.0 | 22.8 | 16.2 | 25.9 |
| Tool Decathlon | 31.5 | 21.2 | 28.7 | 12.0 | 26.9 |
| MCPMark | 36.3 | 18.1 | 27.0 | 14.2 | 37.0 |
| MCP-Atlas | 68.4 | 57.2 | 62.4 | 50.0 | 62.8 |
| WideSearch | 66.4 | 35.2 | 59.1 | 38.3 | 60.1 |
| **Knowledge** |
| MMLU-Pro | 86.1 | 85.2 | 85.3 | 82.6 | 85.2 |
| MMLU-Redux | 93.2 | 93.7 | 93.3 | 92.7 | 93.3 |
| SuperGPQA | 65.6 | 65.7 | 63.4 | 61.4 | 64.7 |
| C-Eval | 90.5 | 82.6 | 90.2 | 82.5 | 90.0 |
| **STEM & Reasoning** |
| GPQA | 85.5 | 84.3 | 84.2 | 82.3 | 86.0 |
| HLE | 24.3 | 19.5 | 22.4 | 8.7 | 21.4 |
| LiveCodeBench v6 | 80.7 | 80.0 | 74.6 | 77.1 | 80.4 |
| HMMT Feb 25 | 92.0 | 88.7 | 89.0 | 91.7 | 90.7 |
| HMMT Nov 25 | 89.8 | 87.5 | 89.2 | 87.5 | 89.1 |
| HMMT Feb 26 | 84.3 | 77.2 | 78.7 | 79.0 | 83.6 |
| IMOAnswerBench | 79.9 | 74.5 | 76.8 | 74.3 | 78.9 |
| AIME26 | 92.6 | 89.2 | 91.0 | 88.3 | 92.7 |

> Table 1: Qwen3.6-35B-A3B natural language benchmark comparison. Data from official blog, April 2026.

**Benchmark notes:**

- SWE-Bench Series: internal agent scaffold (bash + file-edit tools); temp=1.0, top_p=0.95, 200K ctx.
- Terminal-Bench 2.0: Harbor/Terminus-2 harness; 3h timeout; 256K ctx; 5-run average.
- SkillsBench: OpenCode on 78 self-contained tasks; 5-run average.
- QwenClawBench: internal real-user Claw agent benchmark (to be open-sourced).
- QwenWebBench: internal frontend code generation benchmark; BT/Elo scoring.

#### 1.1.2 Qwen3.6-27B vs Prior Gen and Frontier Models

| Benchmark | Qwen3.5-27B | Qwen3.5-397B-A17B | Gemma4-31B | Claude 4.5 Opus | Qwen3.6-35B-A3B | Qwen3.6-27B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Coding Agent** |
| SWE-bench Verified | 75.0 | 76.2 | 52.0 | 80.9 | 73.4 | 77.2 |
| SWE-bench Pro | 51.2 | 50.9 | 35.7 | 57.1 | 49.5 | 53.5 |
| SWE-bench Multilingual | 69.3 | 69.3 | 51.7 | 77.5 | 67.2 | 71.3 |
| Terminal-Bench 2.0 | 41.6 | 52.5 | 42.9 | 59.3 | 51.5 | 59.3 |
| SkillsBench Avg5 | 27.2 | 30.0 | 23.6 | 45.3 | 28.7 | 48.2 |
| QwenWebBench | 1068 | 1186 | 1197 | 1536 | 1397 | 1487 |
| NL2Repo | 27.3 | 32.2 | 15.5 | 43.2 | 29.4 | 36.2 |
| Claw-Eval Avg | 64.3 | 70.7 | 48.5 | 76.6 | 68.7 | 72.4 |
| Claw-Eval Pass^3 | 46.2 | 48.1 | 25.0 | 59.6 | 50.0 | 60.6 |
| QwenClawBench | 52.2 | 51.8 | 41.7 | 52.3 | 52.6 | 53.4 |
| **Knowledge** |
| MMLU-Pro | 86.1 | 87.8 | 85.2 | 89.5 | 85.2 | 86.2 |
| MMLU-Redux | 93.2 | 94.9 | 93.7 | 95.6 | 93.3 | 93.5 |
| SuperGPQA | 65.6 | 70.4 | 65.7 | 70.6 | 64.7 | 66.0 |
| C-Eval | 90.5 | 93.0 | 82.6 | 92.2 | 90.0 | 91.4 |
| **STEM & Reasoning** |
| GPQA Diamond | 85.5 | 88.4 | 84.3 | 87.0 | 86.0 | 87.8 |
| HLE | 24.3 | 28.7 | 19.5 | 30.8 | 21.4 | 24.0 |
| LiveCodeBench v6 | 80.7 | 83.6 | 80.0 | 84.8 | 80.4 | 83.9 |
| HMMT Feb 25 | 92.0 | 94.8 | 88.7 | 92.9 | 90.7 | 93.8 |
| HMMT Nov 25 | 89.8 | 92.7 | 87.5 | 93.3 | 89.1 | 90.7 |
| HMMT Feb 26 | 84.3 | 87.9 | 77.2 | 85.3 | 83.6 | 84.3 |
| IMOAnswerBench | 79.9 | 80.9 | 74.5 | 84.0 | 78.9 | 80.8 |
| AIME26 | 92.6 | 93.3 | 89.2 | 95.1 | 92.7 | 94.1 |

> Table 2: Qwen3.6-27B natural language benchmark comparison.

### 1.2 Vision-Language Benchmarks

#### 1.2.1 Qwen3.6-35B-A3B Vision-Language Performance

| Benchmark | Qwen3.5-27B | Claude-Sonnet-4.5 | Gemma4-31B | Gemma4-26B-A4B | Qwen3.5-35B-A3B | Qwen3.6-35B-A3B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM & Puzzles** |
| MMMU | 82.3 | 79.6 | 80.4 | 78.4 | 81.4 | 81.7 |
| MMMU-Pro | 75.0 | 68.4 | 76.9* | 73.8* | 75.1 | 75.3 |
| Mathvista(mini) | 87.8 | 79.8 | 79.3 | 79.4 | 86.2 | 86.4 |
| ZEROBench_sub | 36.2 | 26.3 | 26.0 | 26.3 | 34.1 | 34.4 |
| **General VQA** |
| RealWorldQA | 83.7 | 70.3 | 72.3 | 72.2 | 84.1 | 85.3 |
| MMBenchEN-DEV-v1.1 | 92.6 | 88.3 | 90.9 | 89.0 | 91.5 | 92.8 |
| SimpleVQA | 56.0 | 57.6 | 52.9 | 52.2 | 58.3 | 58.9 |
| HallusionBench | 70.0 | 59.9 | 67.4 | 66.1 | 67.9 | 69.8 |
| **OCR & Document Understanding** |
| OmniDocBench1.5 | 88.9 | 85.8 | 80.1 | 74.4 | 89.3 | 89.9 |
| CharXiv(RQ) | 79.5 | 67.2 | 67.9 | 69.0 | 77.5 | 78.0 |
| CC-OCR | 81.0 | 68.1 | 75.7 | 74.5 | 80.7 | 81.9 |
| AI2D_TEST | 92.9 | 87.0 | 89.0 | 88.3 | 92.6 | 92.7 |
| **Spatial Intelligence** |
| RefCOCO(avg) | 90.9 | -- | -- | -- | 89.2 | 92.0 |
| ODInW13 | 41.1 | -- | -- | -- | 42.6 | 50.8 |
| EmbSpatialBench | 84.5 | 71.8 | -- | -- | 83.1 | 84.3 |
| RefSpatialBench | 67.7 | -- | -- | -- | 63.5 | 64.3 |
| **Video Understanding** |
| VideoMME(w sub.) | 87.0 | 81.1 | -- | -- | 86.6 | 86.6 |
| VideoMME(w/o sub.) | 82.8 | 75.3 | -- | -- | 82.5 | 82.5 |
| VideoMMMU | 82.3 | 77.6 | 81.6 | 76.0 | 80.4 | 83.7 |
| MLVU | 85.9 | 72.8 | -- | -- | 85.6 | 86.2 |
| MVBench | 74.6 | -- | -- | -- | 74.8 | 74.6 |
| LVBench | 73.6 | -- | -- | -- | 71.4 | 71.4 |

> Table 3: Qwen3.6-35B-A3B vision-language benchmark comparison.

#### 1.2.2 Qwen3.6-27B Vision-Language Performance

| Benchmark | Qwen3.5-27B | Qwen3.5-397B-A17B | Gemma4-31B | Claude 4.5 Opus | Qwen3.6-35B-A3B | Qwen3.6-27B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM & Puzzles** |
| MMMU | 82.3 | 85.0 | 80.4 | 80.7 | 81.7 | 82.9 |
| MMMU-Pro | 75.0 | 79.0 | 76.9 | 70.6 | 75.3 | 75.8 |
| MathVista mini | 87.8 | -- | 79.3 | -- | 86.4 | 87.4 |
| DynaMath | 87.7 | 86.3 | 79.5 | 79.7 | 82.8 | 85.6 |
| VlmsAreBlind | 96.9 | -- | 87.2 | -- | 96.6 | 97.0 |
| **General VQA** |
| RealWorldQA | 83.7 | 83.9 | 72.3 | 77.0 | 85.3 | 84.1 |
| MMStar | 81.0 | 83.8 | 77.3 | 73.2 | 80.7 | 81.4 |
| MMBenchEN-DEV-v1.1 | 92.6 | -- | 90.9 | -- | 92.8 | 92.3 |
| SimpleVQA | 56.0 | 67.1 | 52.9 | 65.7 | 58.9 | 56.1 |
| **Document Understanding** |
| CharXiv RQ | 79.5 | 80.8 | 67.9 | 68.5 | 78.0 | 78.4 |
| CC-OCR | 81.0 | 82.0 | 75.7 | 76.9 | 81.9 | 81.2 |
| OCRBench | 89.4 | -- | 86.1 | -- | 90.0 | 89.4 |
| **Spatial Intelligence** |
| ERQA | 60.5 | 67.5 | 57.5 | 46.8 | 61.8 | 62.5 |
| CountBench | 97.8 | 97.2 | 96.1 | 90.6 | 96.1 | 97.8 |
| RefCOCO avg | 90.9 | 92.3 | -- | -- | 92.0 | 92.5 |
| EmbSpatialBench | 84.5 | -- | -- | -- | 84.3 | 84.6 |
| RefSpatialBench | 67.7 | -- | 4.7 | -- | 64.3 | 70.0 |
| **Video Understanding** |
| VideoMME(w sub.) | 87.0 | 87.5 | -- | 77.7 | 86.6 | 87.7 |
| VideoMMMU | 82.3 | 84.7 | 81.6 | 84.4 | 83.7 | 84.4 |
| MLVU | 85.9 | 86.7 | -- | 81.7 | 86.2 | 86.6 |
| MVBench | 74.6 | 77.6 | -- | 67.2 | 74.6 | 75.5 |
| **Vision Agent** |
| V* | 93.7 | 95.8 | -- | 67.0 | 90.1 | 94.7 |
| AndroidWorld | 64.2 | -- | -- | -- | -- | 70.3 |

> Table 4: Qwen3.6-27B vision-language benchmark comparison.

## 2 Usage and Deployment

### 2.1 API and Open Weights

Open weights on Hugging Face and ModelScope; API via Bailian (`qwen3.6-flash`, `qwen3.6-27b`); instant experience on Qwen Studio. Integrates with OpenClaw, Claude Code, Qwen Code.

### 2.2 New Feature: preserve_thinking

`preserve_thinking` retains all prior-turn thinking content in messages, recommended for agent tasks. Preserves full reasoning chains across multi-turn tool-calling.

### 2.3 Third-Party Tool Integration

Compatible OpenAI chat completion API and Anthropic-compatible API. `enable_thinking=True` for reasoning; `enable_search=True` for web search. Streaming: `reasoning_content` for thinking, `content` for final answer.

## 3 Summary

Qwen3.6-35B-A3B shows sparse MoE can deliver flagship agentic coding with only 3B activated parameters. Qwen3.6-27B proves a carefully trained dense model can surpass a much larger MoE predecessor on developer-critical tasks while being easier to deploy.

The Qwen3.6 open family now spans 3B-activated MoE (35B-A3B), 27B dense, and online Qwen3.6-Plus / Qwen3.6-Max-Preview.

## Citation

```bibtex
@misc{qwen36_35b_a3b,
    title = {Qwen3.6-35B-A3B: Agentic Coding Power, Now Open to All},
    url = {https://qwen.ai/blog?id=qwen3.6-35b-a3b},
    author = {Qwen Team},
    month = {April},
    year = {2026}
}

@misc{qwen36_27b,
    title = {Qwen3.6-27B: Flagship-Level Coding in a 27B Dense Model},
    url = {https://qwen.ai/blog?id=qwen3.6-27b},
    author = {Qwen Team},
    month = {April},
    year = {2026}
}
```
