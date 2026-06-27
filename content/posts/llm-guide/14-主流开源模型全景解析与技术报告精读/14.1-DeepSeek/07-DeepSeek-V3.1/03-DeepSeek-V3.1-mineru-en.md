---
title: "DeepSeek-V3.1 - Source Notes (EN)"
source_pdf: "pdfs/DeepSeek-V3.1.html"
source_type: "official announcement and model card"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# DeepSeek-V3.1: Source Notes

> [Back to 14.1-DeepSeek family overview](../../14.1-DeepSeek.md)

## Source note

DeepSeek-V3.1 does not have a standalone public technical report PDF in this directory. The available source material is the official release announcement, model card style documentation, deployment notes, and community implementation references preserved under `pdfs/DeepSeek-V3.1.html`.

This English delivery file is therefore not a MinerU extraction from a paper PDF. Instead, it is a cleaned source-note document that captures the main technical claims needed for D4 translation and D5 indexing.

## Core release claims

DeepSeek-V3.1 is presented as an important iteration on top of DeepSeek-V3 and is described as DeepSeek's first concrete step toward the agent era.

The main publicly stated upgrades are:

- A hybrid inference design with both thinking and non-thinking modes inside one deployed model.
- Stronger agent behavior through post-training optimization for multi-step tool use and software engineering tasks.
- Long-context strengthening through large-scale continued pretraining focused on 32K and 128K context scenarios.
- Updated tokenizer and chat-template behavior to support more robust multi-turn interaction and clearer mode switching.

## Architecture continuity

The public materials describe DeepSeek-V3.1 as architecturally continuous with DeepSeek-V3:

- 671B total parameters
- 37B active parameters per token
- DeepSeekMoE plus MLA
- 128K context window in official deployment

This means V3.1 is not introduced as a new architecture family. It is a product and training iteration built on top of the existing V3 base.

## Continued pretraining for long context

The public documentation describes a large continued-pretraining stage dedicated to long-context improvement.

Stage 1 focuses on 32K context extension:

- about 630B tokens
- learning rate aligned with the final phase of V3 pretraining

Stage 2 focuses on 128K context extension:

- about 209B tokens

Together, these stages amount to roughly 840B tokens of continued pretraining aimed at strengthening long-context behavior rather than rebuilding the model from scratch.

## Hybrid inference modes

One of the most notable product-level changes in V3.1 is hybrid reasoning:

- Non-thinking mode is optimized for direct answers and low latency.
- Thinking mode exposes a longer reasoning process and is intended for harder tasks such as complex coding, planning, and math.

The key point is that the switching mechanism is described as template- or serving-level control rather than two separately maintained model families.

## Agent-oriented improvements

The official materials position V3.1 as more agent-ready than V3:

- stronger tool-use behavior
- better multi-step execution
- better SWE-Bench and Terminal-Bench style performance
- support for stricter function-calling workflows in the API ecosystem

This suggests that DeepSeek is moving from pure model-quality scaling toward a product architecture where reasoning, tool use, and deployment compatibility are all treated as first-class concerns.

## Deployment and compatibility

Public deployment notes emphasize that V3.1 remains broadly compatible with the existing V3 inference stack:

- vLLM deployments
- SGLang deployments
- FP8 or BF16 style inference paths depending environment support

This continuity lowers migration cost for existing V3 users.

## Limits of the available sources

Because there is no standalone technical report PDF here, several details remain unspecified in primary public materials:

- no full paper-style ablation section
- no complete training hyperparameter appendix
- no full benchmark methodology write-up equivalent to V3 or R1 reports

As a result, any deeper engineering interpretation should be treated as an inference from the official release notes and surrounding deployment documentation rather than as a verbatim paper claim.
