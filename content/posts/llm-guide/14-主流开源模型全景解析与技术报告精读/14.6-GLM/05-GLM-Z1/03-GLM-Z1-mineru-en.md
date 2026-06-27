---
title: "GLM-Z1 - Source Notes (EN)"
source: "Z.ai PR release, Hugging Face model cards, Zhipu MaaS documentation"
source_type: "official product announcement (no standalone technical report PDF)"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# GLM-Z1: Cold-Start Extended RL Reasoning Models

> [Back to 14.6-GLM family overview](../../14.6-GLM.md)

## Source note

GLM-Z1 has no standalone arXiv technical report. Z.ai (formerly Zhipu) open-sourced the GLM-4-0414 series on **2025-04-15**, including base, reasoning (Z1), and rumination variants in 9B and 32B sizes under the MIT license. This English file is a cleaned source-note document synthesized from official announcements, Hugging Face model cards, and platform documentation—not a MinerU PDF extraction.

## 1 Release Overview

On April 15, 2025, Z.ai announced the open-sourcing of:

| Model | Role |
|:---|:---|
| GLM-4-32B-0414 / GLM-4-9B-0414 | Base models |
| **GLM-Z1-32B-0414 / GLM-Z1-9B-0414** | Reasoning models |
| GLM-Z1-Rumination-32B-0414 | Tool-augmented "rumination" agent model |

All models are MIT-licensed and available on Hugging Face, ModelScope, and the Z.ai experience platform.

## 2 Base Model: GLM-4-32B-0414

GLM-Z1 is built on **GLM-4-32B-0414**, a 32B dense decoder-only model:

- **Pre-training**: 15T high-quality tokens, including large-scale synthetic reasoning data
- **Post-training**: rejection sampling + RL for instruction following, engineering code, function calling
- **Benchmarks**: competitive with GPT-4o and DeepSeek-V3-0324 (671B) on engineering code, artifact generation, function calling, search QA, and report generation

## 3 GLM-Z1 Training Method

### 3.1 Cold Start + Extended RL

Unlike DeepSeek-R1-Zero (pure RL from base), GLM-Z1 uses a **hybrid pipeline**:

1. **Cold start**: SFT on a small set of high-quality reasoning traces to stabilize CoT format
2. **Extended RL**: large-scale RL on verifiable domains (math, code, logic)
3. **General RL**: pairwise ranking feedback to improve non-verifiable general capabilities

**Rationale**: pure RL from scratch can produce correct reasoning but unstable output formats; cold start provides a parseable reasoning template before RL scaling.

### 3.2 Pairwise Ranking RL

GLM-Z1 introduces **general reinforcement learning based on pairwise ranking feedback**:

- Generate multiple candidate answers per prompt
- Rank pairs rather than assign absolute scalar scores
- More stable and scalable than absolute reward modeling for open-ended tasks

This complements domain-specific verifiable rewards (math/code correctness) used in the extended RL stage.

### 3.3 Comparison with DeepSeek-R1

| Dimension | GLM-Z1 | DeepSeek-R1 |
|:---|:---|:---|
| Parameter scale | 32B / 9B | 671B |
| RL algorithm (general) | Pairwise ranking RL | GRPO |
| Cold start | Yes (before extended RL) | R1 uses cold start; R1-Zero does not |
| Tool integration | GLM-Z1-Rumination | No official rumination variant |
| Inference speed | AirX ~200 tok/s | Standard inference |

## 4 Model Family and Deployment

### 4.1 Commercial API Tiers (MaaS)

| Variant | Positioning | Key metric |
|:---|:---|:---|
| GLM-Z1-AirX | Ultra-fast | ~200 tokens/s |
| GLM-Z1-Air | Cost-effective | ~1/30 cost vs DeepSeek-R1 |
| GLM-Z1-Flash | Free tier | Permanent free access |

Speed optimizations include GQA tuning, quantization, and speculative decoding.

### 4.2 GLM-Z1-Rumination

The rumination model extends Z1 with **tool-augmented deep research**:

1. Autonomous question decomposition
2. Real-time web search
3. Multi-angle analysis and hypothesis revision
4. Structured report generation

Training adds RL on tool-use trajectories with rewards for answer quality, search efficiency, and information integration.

## 5 Performance Claims

Official positioning (April 2025):

- GLM-Z1-32B reasoning performance **comparable to DeepSeek-R1 (671B)** on math/code/logic benchmarks
- GLM-Z1-9B competitive among same-size open models; deployable on consumer GPUs (e.g., RTX 4090)
- Benchmarks cited include AIME 2024/2025, LiveCodeBench, GPQA (exact scores in model cards vary by eval setup)

## 6 Technical Evolution Path

```
GLM-4-32B-0414 (base)
    → GLM-Z1-32B-0414 (reasoning, cold-start + extended RL)
        → GLM-Z1-Rumination-32B-0414 (tool-augmented research agent)
            → GLM-4.5 (MoE hybrid thinking/non-thinking, integrates Z1 reasoning)
```

GLM-4.5 (arXiv:2508.06471) explicitly integrates reasoning capabilities from GLM-Z1 into a unified MoE architecture with hybrid thinking modes.

## 7 Limitations

- No standalone peer-reviewed technical report for Z1 training details (hyperparameters, reward design, RL infrastructure)
- Performance comparisons largely from Z.ai internal or platform-side evaluations
- Rumination model depends on external search/tools; latency and reliability vary by deployment
- 32B dense model still requires significant VRAM for local full-precision inference

## 8 Key Specifications

| Attribute | Specification |
|:---|:---|
| Release date | 2025-04-15 |
| License | MIT |
| Sizes | 9B, 32B |
| Base architecture | Dense GLM decoder (32B / 9B) |
| Training | Cold start SFT + extended RL + pairwise ranking RL |
| Variants | Z1 (reasoning), Z1-Rumination (tool agent) |
| API tiers | AirX / Air / Flash |
| Open weights | Hugging Face `zai-org/GLM-Z1-32B-0414` |
