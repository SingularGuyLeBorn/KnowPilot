---
title: "03 · Kimi K2.6 - Source Notes (EN)"
source: "https://www.kimi.com/blog/kimi-k2-6"
source_type: "official blog (no technical report PDF as of 2026-05)"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Kimi K2.6: Advancing Open-Source Coding

> [Back to 14.5-Kimi family overview](../../14.5-Kimi.md)

## Source note

Kimi K2.6 (released 2026-04-20) has no standalone arXiv technical report PDF. This English document is synthesized from the official Moonshot blog, API documentation, and third-party benchmark summaries—not a MinerU PDF extraction.

## 1 Model Overview

Moonshot AI released Kimi K2.6 as its latest open-source flagship: a native multimodal agentic model for long-horizon coding, autonomous execution, and multi-agent orchestration. It matches or exceeds GPT-5.4 and Claude Opus 4.6 on several coding and agentic benchmarks while keeping open-weight pricing.

| Dimension | Specification |
| --- | --- |
| Total parameters | 1T |
| Activated parameters | 32B/token |
| Architecture | MoE + MLA + MoonViT |
| Layers | 61 (1 dense + 60 MoE) |
| Experts | 384 total, 8 routed + 1 shared per token |
| Context window | 256K tokens |
| Max output | 65,536 tokens/response |
| Vocabulary | 160K |
| Vision encoder | MoonViT 400M (internal; API does not expose image input yet) |
| Training data | 15.5T tokens |
| Quantization | Native INT4 / FP4 |
| Inference | vLLM, SGLang, KTransformers |
| License | Modified MIT |

**Pricing (API):** Input $0.60 / Output $4.00 per 1M tokens (cache hit $0.16 input)—roughly 1/8 of GPT-5.5 input cost.

![](images/figure_01_hero_long_horizon_coding.png)
Figure 1: Official blog hero—long-horizon coding positioning.

## 2 Long-Horizon Coding

K2.6 generalizes across languages (Rust, Go, Python) and task types (frontend, DevOps, performance). Showcase: locally deploy Qwen3.5-0.8B on Mac, implement and optimize inference in Zig over 12+ hours, 4000+ tool calls, 14 iterations—throughput from ~15 to ~193 tokens/sec (~20% faster than LM Studio).

![](images/figure_02_zig_inference_case.png)
Figure 2: Long-horizon coding case—Zig inference engine optimization.

## 3 Agent Swarm

Core differentiator vs K2.5: scale from 100 sub-agents / 1500 coordination steps to **300 sub-agents / 4000 steps** (~3× parallelization). The orchestrator dynamically decomposes tasks; heterogeneous agents combine search, research, document analysis, and multi-format generation. Claw Groups (research preview): cross-vendor human-AI collaboration with K2.6 as coordinator.

- Up to 300 parallel sub-agents
- 4000+ tool calls per run
- ~4.5× faster wall-clock vs single-agent baseline
- Learned orchestration via PARL-style RL (not static prompt workflows)

## 4 Skills

Convert high-quality files (PDF, spreadsheets, slides, Word) into reusable **Skills** capturing structure + style + reasoning DNA. Examples: McKinsey-style quant PPT skill; astrophysics paper → 40-page report + dataset + charts; 100 sub-agents matching 100 CA jobs from one CV; 30 retail landing pages from Google Maps discovery.

## 5 Coding-Driven Design & Proactive Agent

**Coding-Driven Design:** Natural language UI prompts → production HTML/CSS/JS.

**Proactive Agent:** 24/7 background execution (schedule checks, data processing); Open mode for live observation; up to 5-day runs in OpenClaw/Hermes-style frameworks.

## 6 Benchmark Results

All scores from Moonshot blog / third-party summaries. Competitor scores marked * are Moonshot re-runs under same harness.

| Category | Benchmark | Kimi K2.6 | GPT-5.4 | Claude Opus 4.6 | Gemini 3.1 Pro |
| --- | --- | --- | --- | --- | --- |
| Agentic | HLE Full (w/ tools) | 54.0 | 52.1 | 53.0 | 51.4 |
| Agentic | DeepSearchQA | 83.0 | 63.7 | 80.6 | 60.2 |
| Agentic | BrowseComp (single) | 83.2 | - | - | - |
| Agentic | BrowseComp (Swarm) | 86.3 | - | - | - |
| Coding | SWE-Bench Pro | 58.6 | 57.7 | 53.4 | 54.2 |
| Coding | SWE-Bench Verified | 80.2 | - | 80.8 | - |
| Coding | LiveCodeBench v6 | 89.6 | - | 88.8 | 91.7 |
| Reasoning | AIME 2026 | 96.4 | 99.2 | 96.7* | 98.3* |
| Reasoning | GPQA-Diamond | 90.5 | 92.8 | 91.3 | 94.3 |
| Reasoning | HLE-Full | 34.7 | 39.8 | 40.0 | 44.4 |
| Vision | MathVision (w/ Python) | 93.2 | 96.1* | 84.6* | 95.7* |
| Vision | MMMU-Pro | 79.4 | 81.2 | 73.9 | 83.0* |

![](images/figure_03_benchmark_overview.png)
Figure 3: Benchmark overview across General Agents, Coding, and Visual Agents.

## 7 Comparison with K2.5

Same architecture and deployment; differences are post-training only (long-horizon stability, instruction following, Swarm coordination).

| Capability | K2.5 | K2.6 | Change |
| --- | --- | --- | --- |
| Max parallel sub-agents | 100 | 300 | 3× |
| Max coordination steps | 1,500 | 4,000 | 2.7× |
| Context window | 128K | 256K | 2× |
| Video input | No | Yes | New |
| BrowseComp (Swarm) | 78.4 | 86.3 | +7.9 |

## 8 Deployment & Limitations

**Self-host:** 256K context INT4 ≈ 8× H200 141GB (~640GB VRAM). Weights: `moonshotai/Kimi-K2.6` on HuggingFace.

**Limitations:** Pure reasoning still behind GPT-5.4 on AIME/GPQA; multimodal average rank ~26/115; high output token volume (170M in Intelligence Index eval); most benchmarks first-party reported; long-horizon reliability in production TBD.

## References

- Official blog: https://www.kimi.com/blog/kimi-k2-6
- Prior reports: Kimi K2 (arXiv:2507.20534), Kimi K2.5 (arXiv:2602.02276)
