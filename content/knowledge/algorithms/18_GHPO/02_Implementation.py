"""
算法名称: Guided Hybrid Policy Optimization (GHPO)
别名: Hybrid RLHF / PPO-ptx
核心思想: 在 RL 训练过程中混入高质量 SFT 数据，防止遗忘和对齐税. 

公式:
L_total = L_RL + lambda * L_SFT
"""

import torch
import torch.nn as nn
from typing import Dict

def compute_hybrid_loss(
    model: nn.Module,
    rl_batch: Dict,        # PPO Batch (Prompts only)
    sft_batch: Dict,       # SFT Batch (Prompts + Responses)
    rl_loss_fn,            # Function to compute RL loss (e.g. PPO Clip)
    sft_coef: float = 0.5
) -> torch.Tensor:
    """
    计算混合 Loss
    
    Args:
        sft_coef: 混合系数 (lambda)
    """
    # 1. RL Loss Calculation
    # (假设已经完成了 rollout 和 advantage math)
    # 这里只是示意
    rl_loss, rl_metrics = rl_loss_fn(model, rl_batch)
    
    # 2. SFT Loss Calculation (Standard LM Loss)
    # 需要对 SFT Batch 进行 forward
    sft_input_ids = sft_batch['input_ids']
    sft_labels = sft_batch['labels']
    
    sft_outputs = model(sft_input_ids, labels=sft_labels)
    sft_loss = sft_outputs.loss
    
    # 3. Combine
    total_loss = rl_loss + sft_coef * sft_loss
    
    return total_loss, {
        "rl_loss": rl_loss.item(),
        "sft_loss": sft_loss.item(),
        "total_loss": total_loss.item()
    }

# Dynamic Mixing Schedule
def get_sft_coef(current_step, total_steps, initial_coef=1.0, final_coef=0.1):
    """
    很多时候我们希望前期强约束 (SFT权重高)，后期放开 (RL权重高)
    """
    progress = current_step / total_steps
    return initial_coef + (final_coef - initial_coef) * progress
