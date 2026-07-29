"""
算法名称: Odds Ratio Preference Optimization (ORPO)
论文: ORPO: Monolithic Preference Optimization without Reference Model
作者: Jiwoo Hong et al. (KAIST)
年份: 2024
arXiv: 2403.07691

核心创新:
1. 无参考模型 (Reference-Free): 节省显存
2. 单阶段训练 (Monolithic): SFT + Preference 一步到位
3. Odds Ratio Loss: 使用优势比惩罚生成坏回复

核心公式:
L_ORPO = L_SFT + lambda * L_OR
L_OR = -log sigma( log(odds_chosen) - log(odds_rejected) )
log(odds) = log(p / (1-p))

参考实现:
- https://github.com/huggingface/trl/blob/main/trl/trainer/orpo_trainer.py
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
class ORPOConfig:
    """ORPO算法超参数配置
    
    Attributes:
        beta: ORPO中的lambda (权重系数) !!注意：虽然论文叫lambda，但开源库常用beta命名以便与DPO统一接口
        learning_rate: 学习率
    """
    beta: float = 0.1  # 论文中的 lambda
    learning_rate: float = 1e-6

# ============================================
# 第二部分: Log Odds 计算核心
# ============================================

def compute_log_odds(
    log_probs: torch.Tensor,
    epsilon: float = 1e-6
) -> torch.Tensor:
    """
    计算 Log Odds
    
    公式:
    odds = p / (1-p)
    log_odds = log(p) - log(1-p)
    
    因为输入是 log_probs (log p)，所以:
    log_odds = log_p - log(1 - exp(log_p))
             = log_p - log1p(-exp(log_p))
    
    Args:
        log_probs: 序列的Log概率 (Sum of token log probs)
    """
    # 数值稳定性处理：防止 probability 接近 1 导致 log(0)
    # 实际上当 p -> 1, odds -> inf, log_odds -> inf
    # 我们可以通过 clamp log_probs 来避免 NaN
    # log_p = 0 -> p = 1 -> 1-p = 0 -> log(0) = -inf
    
    # 稍微截断一下
    log_probs = torch.clamp(log_probs, max=-epsilon)
    
    # log(1 - p) = log(1 - exp(log_p))
    log_one_minus_p = torch.log1p(-torch.exp(log_probs))
    
    log_odds = log_probs - log_one_minus_p
    return log_odds

# ============================================
# 第三部分: Token级Log概率计算
# ============================================

def get_batch_log_probs(
    logits: torch.Tensor,
    labels: torch.Tensor,
    attention_mask: torch.Tensor,
    average_log_prob: bool = True
) -> torch.Tensor:
    """
    计算每个序列的总Log概率(或平均Log概率)
    
    ORPO论文中使用的是 "Average Log Probability" 来计算 Odds
    即: log_p = sum(token_log_probs) / length
    """
    shift_logits = logits[..., :-1, :].contiguous()
    shift_labels = labels[..., 1:].contiguous()
    shift_mask = attention_mask[..., 1:].contiguous()

    # [Batch, SeqLen-1, Vocab] -> [Batch, SeqLen-1]
    log_probs = F.log_softmax(shift_logits, dim=-1)
    
    # Gather
    per_token_logps = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)
    
    # Apply Mask
    per_token_logps = per_token_logps * shift_mask
    
    # Sum over sequence
    sum_log_probs = per_token_logps.sum(dim=1)
    
    if average_log_prob:
        # Divide by length
        seq_lengths = shift_mask.sum(dim=1)
        return sum_log_probs / seq_lengths
    else:
        return sum_log_probs

# ============================================
# 第四部分: ORPO Loss核心
# ============================================

def compute_orpo_loss(
    policy_chosen_logps: torch.Tensor,
    policy_rejected_logps: torch.Tensor,
    beta: float = 0.1
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """
    计算 Odds Ratio Loss
    
    L_OR = -log sigma( log(odds_w) - log(odds_l) )
    """
    # 1. 计算 Log Odds
    log_odds_chosen = compute_log_odds(policy_chosen_logps)
    log_odds_rejected = compute_log_odds(policy_rejected_logps)
    
    # 2. 计算 Odds Ratio 的 Log (即差值)
    # log(OR) = log(odds_w / odds_l) = log_odds_w - log_odds_l
    log_odds_ratio = log_odds_chosen - log_odds_rejected
    
    # 3. 对数Sigmoid
    # sigma(x) = 1 / (1 + exp(-x))
    # loss = -log(sigma(ratio))
    # 乘上系数 beta (lambda)
    # 注意: TRL库的实现中，ODDS计算是在 probability 层面做的，
    # 但最终使用的是 -F.logsigmoid(log_odds_ratio)
    
    loss = -F.logsigmoid(log_odds_ratio).mean()
    
    # 记录 chosen > rejected 的准确率
    chosen_rewards = log_odds_chosen.detach()
    rejected_rewards = log_odds_rejected.detach()
    accuracy = (chosen_rewards > rejected_rewards).float().mean()
    
    return loss, log_odds_chosen, log_odds_rejected, accuracy

# ============================================
# 第五部分: 完整训练步 (SFT + ORPO)
# ============================================

def orpo_train_step(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    batch: Dict[str, torch.Tensor],
    config: ORPOConfig
) -> Dict[str, float]:
    
    model.train()
    
    # batch通常包含拼接好的 chosen 和 rejected
    # 这里假设输入已经分好: chosen_ids, rejected_ids
    
    # 1. 前向传播 (一次性forward，节省时间，如果显存够)
    # 或者分两次forward
    chosen_output = model(batch["chosen_input_ids"], attention_mask=batch["chosen_attention_mask"])
    rejected_output = model(batch["rejected_input_ids"], attention_mask=batch["rejected_attention_mask"])
    
    # 2. 计算 Log Probs (Average)
    log_probs_w = get_batch_log_probs(
        chosen_output.logits, batch["chosen_input_ids"], batch["chosen_attention_mask"], average_log_prob=True
    )
    log_probs_l = get_batch_log_probs(
        rejected_output.logits, batch["rejected_input_ids"], batch["rejected_attention_mask"], average_log_prob=True
    )
    
    # 3. SFT Loss (只在Chosen上算 NLL)
    # SFT通常用Sum Log Probs，而非Average，这里需要注意统一
    # 我们重新拿sum log probs
    nll_loss = -get_batch_log_probs(
        chosen_output.logits, batch["chosen_input_ids"], batch["chosen_attention_mask"], average_log_prob=False
    ).mean()
    
    # 4. ORPO Loss
    or_loss, lo_w, lo_l, acc = compute_orpo_loss(log_probs_w, log_probs_l, config.beta)
    
    # 5. 总损失
    # L = L_SFT + lambda * L_OR
    total_loss = nll_loss + config.beta * or_loss
    
    optimizer.zero_grad()
    total_loss.backward()
    optimizer.step()
    
    return {
        "loss": total_loss.item(),
        "nll_loss": nll_loss.item(),
        "or_loss": or_loss.item(),
        "accuracy": acc.item(),
        "mean_log_odds_chosen": lo_w.mean().item(),
        "mean_log_odds_rejected": lo_l.mean().item()
    }

# ============================================
# 演示
# ============================================
if __name__ == "__main__":
    print("ORPO Loss Calculation Demo")
    
    # 模拟 Log Probs (Average)
    # 假设 Chosen 的概率比较高，例如 -0.5 (p=0.6)
    # Rejected 的概率比较低，例如 -2.0 (p=0.13)
    
    log_p_w = torch.tensor([-0.5, -0.4, -0.6])
    log_p_l = torch.tensor([-2.0, -1.5, -0.5]) # 第三个样本很难区分
    
    # 1. 计算 Log Odds
    lo_w = compute_log_odds(log_p_w)
    lo_l = compute_log_odds(log_p_l)
    
    print(f"Log Probs W: {log_p_w}")
    print(f"Log Odds W:  {lo_w}")
    print(f"Log Probs L: {log_p_l}")
    print(f"Log Odds L:  {lo_l}")
    
    # 2. 计算 Loss
    loss, _, _, acc = compute_orpo_loss(log_p_w, log_p_l)
    print(f"\nORPO Loss: {loss.item():.4f}")
    print(f"Accuracy: {acc.item():.2f}")
