"""
算法名称: Simple Preference Optimization (SimPO)
论文: SimPO: Simple Preference Optimization with a Reference-Free Reward
作者: Yu Meng et al. (Princeton)
年份: 2024
arXiv: 2405.14734

核心创新:
1. 参考模型移除 (Reference-Free): 显存效率高
2. 长度归一化 (Length Normalization): 避免长度偏见
3. 目标间隔 (Target Margin): 增强鲁棒性

核心公式:
r(y) = (beta / |y|) * log pi(y|x)
L = -log sigma( r(y_w) - r(y_l) - gamma )

参考实现:
- https://github.com/princeton-nlp/SimPO
- https://github.com/huggingface/trl/blob/main/trl/trainer/cpo_trainer.py (CPO/SimPO share logic)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Dict, Optional
from dataclasses import dataclass

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class SimPOConfig:
    """SimPO算法超参数配置"""
    beta: float = 2.0           # 奖励缩放系数 (比DPO大，DPO通常0.1)
    gamma: float = 1.0          # 目标间隔 (Target Margin)
    learning_rate: float = 5e-7 # SimPO通常需要较小的学习率

# ============================================
# 第二部分: Average Log Probability 计算
# ============================================

def get_batch_avg_log_probs(
    logits: torch.Tensor,
    labels: torch.Tensor,
    attention_mask: torch.Tensor
) -> torch.Tensor:
    """
    计算序列的平均Log概率 (Length Normalized)
    
    Args:
        logits: [B, T, V]
        labels: [B, T]
        attention_mask: [B, T]
        
    Returns:
        avg_log_probs: [B]
    """
    # Shift for next token prediction
    shift_logits = logits[..., :-1, :].contiguous()
    shift_labels = labels[..., 1:].contiguous()
    shift_mask = attention_mask[..., 1:].contiguous()

    # Log Softmax
    log_probs = F.log_softmax(shift_logits, dim=-1)
    
    # Gather token log probs
    per_token_logps = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)
    
    # Mask padding tokens
    per_token_logps = per_token_logps * shift_mask
    
    # Sum over sequence
    sum_log_probs = per_token_logps.sum(dim=1)
    
    # Count valid tokens (Length)
    seq_lengths = shift_mask.sum(dim=1)
    
    # Average
    return sum_log_probs / seq_lengths

# ============================================
# 第三部分: SimPO Loss核心
# ============================================

def compute_simpo_loss(
    policy_chosen_avg_logps: torch.Tensor,
    policy_rejected_avg_logps: torch.Tensor,
    config: SimPOConfig
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """
    计算 SimPO Loss
    
    L = -log sigma( (beta/L_w)*logP_w - (beta/L_l)*logP_l - gamma )
      = -log sigma( beta * (avg_logp_w - avg_logp_l) - gamma )
    
    Args:
        policy_chosen_avg_logps: 已经除以长度的log probability
        policy_rejected_avg_logps: 已经除以长度的log probability
    """
    # 1. 计算 Logit Margin
    # delta = avg_logp_w - avg_logp_l
    logits_diff = policy_chosen_avg_logps - policy_rejected_avg_logps
    
    # 2. 应用 Beta 和 Gamma
    # z = beta * delta - gamma
    z = config.beta * logits_diff - config.gamma
    
    # 3. Log Sigmoid Loss
    loss = -F.logsigmoid(z).mean()
    
    # 4. 准确率指标 (Chosen > Rejected)
    # 注意 SimPO 实际上要求 Chosen > Rejected + Gamma/Beta
    # 但通常 accuracy metric 还是看 raw score 谁大
    accuracy = (policy_chosen_avg_logps > policy_rejected_avg_logps).float().mean()
    
    return loss, accuracy, logits_diff

# ============================================
# 第四部分: 完整训练步
# ============================================

def simpo_train_step(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    batch: Dict[str, torch.Tensor],
    config: SimPOConfig
) -> Dict[str, float]:
    
    model.train()
    
    # 1. 前向传播 (Concat chosen/rejected to speed up)
    # 这里假设分开传以清晰展示逻辑
    chosen_out = model(batch["chosen_input_ids"], attention_mask=batch["chosen_attention_mask"])
    rejected_out = model(batch["rejected_input_ids"], attention_mask=batch["rejected_attention_mask"])
    
    # 2. 计算平均 Log Prob
    avg_logp_w = get_batch_avg_log_probs(
        chosen_out.logits, batch["chosen_input_ids"], batch["chosen_attention_mask"]
    )
    avg_logp_l = get_batch_avg_log_probs(
        rejected_out.logits, batch["rejected_input_ids"], batch["rejected_attention_mask"]
    )
    
    # 3. 计算 Loss
    loss, acc, diff = compute_simpo_loss(avg_logp_w, avg_logp_l, config)
    
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    
    return {
        "loss": loss.item(),
        "accuracy": acc.item(),
        "mean_logp_diff": diff.mean().item(),
        "avg_logp_w": avg_logp_w.mean().item(),
        "avg_logp_l": avg_logp_l.mean().item()
    }

# ============================================
# 演示
# ============================================
if __name__ == "__main__":
    print("SimPO Loss Demo")
    config = SimPOConfig(beta=2.5, gamma=1.2)
    
    # 模拟数据
    # Chosen (Len=10, SumLogP=-5.0) -> Avg = -0.5
    # Rejected (Len=20, SumLogP=-12.0) -> Avg = -0.6
    # Diff = 0.1
    avg_w = torch.tensor([-0.5])
    avg_l = torch.tensor([-0.6])
    
    print(f"Avg LogP W: {avg_w.item()}")
    print(f"Avg LogP L: {avg_l.item()}")
    
    loss, _, _ = compute_simpo_loss(avg_w, avg_l, config)
    
    # Z = 2.5 * (0.1) - 1.2 = 0.25 - 1.2 = -0.95
    # Loss = -log(sigma(-0.95)) = -log(0.278) = 1.27
    print(f"SimPO Loss (beta={config.beta}, gamma={config.gamma}): {loss.item():.4f}")
    
    # 尽管 w > l (0.1差距), 但因为没有达到 gamma (1.2), 仍然有较大 Loss
    # 这迫使模型拉大差距
